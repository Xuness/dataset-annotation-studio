from __future__ import annotations

import hashlib
import secrets
import uuid
from contextlib import closing
from pathlib import Path
from typing import TYPE_CHECKING, Annotated

from pydantic import Field, TypeAdapter

from dataset_studio.core.files import file_sha256
from dataset_studio.core.paths import relative_path_key
from dataset_studio.core.sqlite import connect, transaction
from dataset_studio.core.time import utc_now_iso
from dataset_studio.modules.assets.candidates import ensure_assets_in_effective_scope
from dataset_studio.modules.assets.models import CandidateScope
from dataset_studio.modules.assets.repository import AssetRepository
from dataset_studio.modules.cropping.geometry import centered_rectangle, validate_rectangle
from dataset_studio.modules.cropping.images import inspect_image
from dataset_studio.modules.cropping.models import (
    BatchCropRequest,
    CropFilter,
    CropPlan,
    CropPlanItem,
    CropScopeRequest,
    SingleCropRequest,
    StoredBatchCrop,
    StoredSingleCrop,
)
from dataset_studio.modules.cropping.workbench_models import (
    MultiCropRequest,
    PositionedBatchCropRequest,
    StoredMultiCrop,
    StoredPositionedBatchCrop,
)
from dataset_studio.modules.preprocessing.planner import _validate_filename

if TYPE_CHECKING:
    from dataset_studio.api.container import AppContainer

CropRequest = SingleCropRequest | BatchCropRequest | MultiCropRequest | PositionedBatchCropRequest

ITEMS = TypeAdapter(list[CropPlanItem])
STORED_REQUEST = TypeAdapter(
    Annotated[
        StoredSingleCrop | StoredBatchCrop | StoredMultiCrop | StoredPositionedBatchCrop,
        Field(discriminator="kind"),
    ]
)


def safe_path(root: Path, relative: str) -> Path:
    path = root / relative
    if Path(relative).is_absolute() or ".." in Path(relative).parts:
        raise ValueError(f"裁剪路径必须位于数据集内：{relative}")
    if not path.resolve().is_relative_to(root.resolve()):
        raise ValueError(f"裁剪路径通过符号链接越出数据集：{relative}")
    return path


def resolve_ids(container: AppContainer, project: str, request: CropScopeRequest) -> list[str]:
    paths, _ = container.workspaces.get(project)
    if request.scope == "selected":
        ids = list(dict.fromkeys(request.asset_ids))
        ensure_assets_in_effective_scope(paths.database, ids)
    else:
        filtered = request.scope == "filtered"
        ids = container.assets.list_asset_ids(
            project,
            search=request.filters.search if filtered else "",
            annotation_status=request.filters.status if filtered else None,
            folder_path=request.filters.folder_path
            if filtered or request.scope == "folder"
            else "",
            folder_paths=(),
            candidate_scope=CandidateScope.AUTO,
        ).ids
    with closing(connect(paths.database)) as connection:
        generated = {str(row[0]) for row in connection.execute("SELECT id FROM crop_outputs")}
    result = [asset_id for asset_id in ids if asset_id not in generated]
    if not result:
        raise ValueError("裁剪范围内没有源图片；空选择或仅包含已生成裁剪结果。")
    return result


def build_items(container: AppContainer, project: str, request: CropRequest) -> list[CropPlanItem]:
    paths, _ = container.workspaces.get(project)
    groups = (
        {item.asset_id: item for item in request.items}
        if isinstance(request, MultiCropRequest)
        else {}
    )
    if isinstance(request, MultiCropRequest):
        ids = list(groups)
        if isinstance(request, PositionedBatchCropRequest):
            eligible = resolve_ids(
                container,
                project,
                CropScopeRequest(
                    scope="selected",
                    asset_ids=ids,
                    filters=CropFilter(search="", status=None, folder_path=""),
                ),
            )
            if eligible != ids:
                raise ValueError("批量手调请求包含已生成的裁剪结果或不在当前范围中的素材。")
    elif isinstance(request, SingleCropRequest):
        ids = [request.asset_id]
    else:
        ids = resolve_ids(container, project, request)
    rows = AssetRepository(paths.database).get_assets(ids)
    items: list[CropPlanItem] = []
    allocated: set[str] = set()
    with closing(connect(paths.database)) as connection:
        reserved_paths = {
            relative_path_key(str(row[0]))
            for row in connection.execute("SELECT relative_path FROM assets")
        }
    for asset_id in ids:
        row = rows.get(asset_id)
        if row is None or not row["is_present"]:
            raise ValueError(f"源素材不存在或已移除：{asset_id}")
        relative = str(row["relative_path"])
        source = safe_path(paths.root, relative)
        width, height = inspect_image(source)
        source_hash = file_sha256(source)
        if source_hash != str(row["content_hash"]):
            raise ValueError(f"源图与索引版本不同，请重新扫描后裁剪：{relative}")
        if isinstance(request, MultiCropRequest):
            group = groups[asset_id]
            if group.source_version != source_hash:
                raise ValueError(f"裁剪草稿的源图版本已变化，请重新载入素材：{relative}")
            rectangles = group.rectangles
            if isinstance(request, PositionedBatchCropRequest):
                maximum = centered_rectangle(width, height, request.ratio)
                rect = rectangles[0]
                if rect.ratio != request.ratio or (rect.width, rect.height) != (
                    maximum.width,
                    maximum.height,
                ):
                    raise ValueError(
                        f"批量手调只能移动统一比例的最大裁剪框，不可缩放或改变比例：{relative}"
                    )
        elif isinstance(request, SingleCropRequest):
            rectangles = request.rectangles
        else:
            rectangles = [centered_rectangle(width, height, request.ratio)]
        parent = Path(relative).parent
        output_parent = Path("cropped") / parent
        for rect in rectangles:
            validate_rectangle(rect, width, height)
            sequence = 1
            while True:
                output = (output_parent / f"{source.stem}_crop_{sequence:04d}.png").as_posix()
                _validate_filename(Path(output).stem, ".png")
                destination = safe_path(paths.root, output)
                occupied = (
                    destination.exists()
                    or destination.with_suffix(".txt").exists()
                    or destination.with_suffix(".json").exists()
                )
                output_key = relative_path_key(output)
                if (
                    not occupied
                    and output_key not in allocated
                    and output_key not in reserved_paths
                ):
                    break
                sequence += 1
            allocated.add(output_key)
            items.append(
                CropPlanItem(
                    source_id=asset_id,
                    source_path=relative,
                    source_hash=source_hash,
                    source_width=width,
                    source_height=height,
                    output_id=str(uuid.uuid4()),
                    output_path=output,
                    rectangle=rect,
                    whole_image=rect.x == rect.y == 0
                    and rect.width == width
                    and rect.height == height,
                )
            )
    return items


def serialize_request(request: CropRequest) -> str:
    if isinstance(request, PositionedBatchCropRequest):
        return StoredPositionedBatchCrop(kind="positioned_batch", request=request).model_dump_json()
    if isinstance(request, MultiCropRequest):
        return StoredMultiCrop(kind="multi", request=request).model_dump_json()
    if isinstance(request, SingleCropRequest):
        return StoredSingleCrop(kind="single", request=request).model_dump_json()
    return StoredBatchCrop(kind="batch", request=request).model_dump_json()


def create_plan(container: AppContainer, project: str, request: CropRequest) -> CropPlan:
    paths, _ = container.workspaces.get(project)
    items = build_items(container, project, request)
    plan_id = str(uuid.uuid4())
    serialized = ITEMS.dump_json(items).decode()
    token = hashlib.sha256((plan_id + serialized + request.model_dump_json()).encode()).hexdigest()
    with transaction(paths.database) as connection:
        connection.execute(
            "INSERT INTO crop_plans VALUES (?, ?, ?, ?, ?)",
            (
                plan_id,
                token,
                serialize_request(request),
                serialized,
                utc_now_iso(),
            ),
        )
    return CropPlan(id=plan_id, token=token, items=items[:24], total=len(items), offset=0, limit=24)


def load_plan(database: Path, plan_id: str) -> tuple[str, list[CropPlanItem], CropRequest]:
    with closing(connect(database)) as connection:
        row = connection.execute("SELECT * FROM crop_plans WHERE id=?", (plan_id,)).fetchone()
    if row is None:
        raise ValueError(f"裁剪预览不存在：{plan_id}")
    request = STORED_REQUEST.validate_json(str(row["request_json"])).request
    return str(row["token"]), ITEMS.validate_json(str(row["plan_json"])), request


def validate_plan(
    container: AppContainer, project: str, plan_id: str, token: str
) -> list[CropPlanItem]:
    paths, _ = container.workspaces.get(project)
    stored_token, stored, request = load_plan(paths.database, plan_id)
    if not secrets.compare_digest(token, stored_token):
        raise ValueError("裁剪预览令牌不匹配，请重新预览。")
    current = build_items(container, project, request)

    def comparable(item: CropPlanItem) -> str:
        return item.model_dump_json(exclude={"output_id"})

    if [comparable(i) for i in stored] != [comparable(i) for i in current]:
        raise ValueError("裁剪预览已失效：源图、范围或目标路径发生变化，请重新预览。")
    return stored
