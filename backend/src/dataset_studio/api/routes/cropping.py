from contextlib import closing
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Response

from dataset_studio.api.container import AppContainer
from dataset_studio.api.dependencies import get_container
from dataset_studio.core.files import file_sha256
from dataset_studio.core.sqlite import connect
from dataset_studio.modules.cropping import execution, presets
from dataset_studio.modules.cropping.images import render_png
from dataset_studio.modules.cropping.models import (
    BatchCropRequest,
    CropExecutionRequest,
    CropOperation,
    CropPlan,
    CropPlanItem,
    CropProvenance,
    CropRect,
    CropScopeRequest,
    RatioPreset,
    RatioPresetInput,
    SingleCropRequest,
)
from dataset_studio.modules.cropping.planner import create_plan, load_plan, resolve_ids, safe_path
from dataset_studio.modules.cropping.sources import source_summaries
from dataset_studio.modules.cropping.storage import operation, provenance
from dataset_studio.modules.cropping.workbench_models import (
    CropSource,
    CropSourceSelection,
    MultiCropRequest,
    PositionedBatchCropRequest,
)
from dataset_studio.modules.workspaces.paths import WorkspacePaths

router = APIRouter(tags=["cropping"])
Container = Annotated[AppContainer, Depends(get_container)]
PREFIX = "/workspaces/{project_id}/cropping"


def global_database(container: AppContainer) -> Path:
    return container.settings.app_data_dir / "global.sqlite3"


@router.get("/crop-ratio-presets", response_model=list[RatioPreset])
def list_ratio_presets(container: Container) -> list[RatioPreset]:
    return presets.list_presets(global_database(container))


@router.post("/crop-ratio-presets", response_model=RatioPreset)
def create_ratio_preset(value: RatioPresetInput, container: Container) -> RatioPreset:
    return presets.save_preset(global_database(container), None, value)


@router.put("/crop-ratio-presets/{preset_id}", response_model=RatioPreset)
def update_ratio_preset(
    preset_id: str, value: RatioPresetInput, container: Container
) -> RatioPreset:
    return presets.save_preset(global_database(container), preset_id, value)


@router.delete("/crop-ratio-presets/{preset_id}", status_code=204)
def delete_ratio_preset(preset_id: str, container: Container) -> Response:
    presets.delete_preset(global_database(container), preset_id)
    return Response(status_code=204)


@router.post(PREFIX + "/single-preview", response_model=CropPlan)
def single_preview(project_id: str, value: SingleCropRequest, container: Container) -> CropPlan:
    with container.preprocessing.guard_workspace(project_id, "crop-preview"):
        execution.ensure_idle(container, project_id)
        return create_plan(container, project_id, value)


@router.post(PREFIX + "/batch-preview", response_model=CropPlan)
def batch_preview(project_id: str, value: BatchCropRequest, container: Container) -> CropPlan:
    with container.preprocessing.guard_workspace(project_id, "crop-preview"):
        execution.ensure_idle(container, project_id)
        return create_plan(container, project_id, value)


@router.post(PREFIX + "/source-selection", response_model=list[CropSource])
def selected_sources(
    project_id: str, value: CropSourceSelection, container: Container
) -> list[CropSource]:
    paths, _ = container.workspaces.get(project_id)
    return source_summaries(paths.database, value.asset_ids)


@router.post(PREFIX + "/source-scope", response_model=list[CropSource])
def scoped_sources(
    project_id: str, value: CropScopeRequest, container: Container
) -> list[CropSource]:
    paths, _ = container.workspaces.get(project_id)
    return source_summaries(paths.database, resolve_ids(container, project_id, value))


@router.post(PREFIX + "/multi-preview", response_model=CropPlan)
def multi_preview(project_id: str, value: MultiCropRequest, container: Container) -> CropPlan:
    with container.preprocessing.guard_workspace(project_id, "crop-preview"):
        execution.ensure_idle(container, project_id)
        return create_plan(container, project_id, value)


@router.post(PREFIX + "/positioned-preview", response_model=CropPlan)
def positioned_preview(
    project_id: str, value: PositionedBatchCropRequest, container: Container
) -> CropPlan:
    with container.preprocessing.guard_workspace(project_id, "crop-preview"):
        execution.ensure_idle(container, project_id)
        return create_plan(container, project_id, value)


@router.get(PREFIX + "/plans/{plan_id}", response_model=CropPlan)
def plan_page(
    project_id: str,
    plan_id: str,
    container: Container,
    offset: Annotated[int, Query(ge=0)],
    limit: Annotated[int, Query(ge=1, le=48)],
) -> CropPlan:
    paths, _ = container.workspaces.get(project_id)
    token, items, _ = load_plan(paths.database, plan_id)
    return CropPlan(
        id=plan_id,
        token=token,
        items=items[offset : offset + limit],
        total=len(items),
        offset=offset,
        limit=limit,
    )


def preview_item(
    container: AppContainer, project_id: str, plan_id: str, index: int
) -> tuple[WorkspacePaths, CropPlanItem]:
    paths, _ = container.workspaces.get(project_id)
    _, items, _ = load_plan(paths.database, plan_id)
    if index < 0 or index >= len(items):
        raise ValueError(f"裁剪预览项目越界：index={index}，total={len(items)}")
    item = items[index]
    source = safe_path(paths.root, item.source_path)
    if not source.is_file():
        raise ValueError(f"裁剪预览已失效，源图被移动或删除：{item.source_path}")
    if file_sha256(source) != item.source_hash:
        raise ValueError(f"裁剪预览已失效，源图发生变化：{item.source_path}")
    return paths, item


@router.get(PREFIX + "/plans/{plan_id}/items/{index}/result")
def result_image(project_id: str, plan_id: str, index: int, container: Container) -> Response:
    paths, item = preview_item(container, project_id, plan_id, index)
    return Response(
        render_png(safe_path(paths.root, item.source_path), item.rectangle, 768),
        media_type="image/png",
    )


@router.get(PREFIX + "/plans/{plan_id}/items/{index}/source")
def source_image(project_id: str, plan_id: str, index: int, container: Container) -> Response:
    paths, item = preview_item(container, project_id, plan_id, index)
    rectangle = CropRect(x=0, y=0, width=item.source_width, height=item.source_height, ratio=None)
    return Response(
        render_png(safe_path(paths.root, item.source_path), rectangle, 768), media_type="image/png"
    )


@router.post(PREFIX + "/execute", response_model=CropOperation)
def execute(project_id: str, value: CropExecutionRequest, container: Container) -> CropOperation:
    return execution.execute(container, project_id, value)


@router.get(PREFIX + "/operations", response_model=list[CropOperation])
def operations(project_id: str, container: Container) -> list[CropOperation]:
    paths, _ = container.workspaces.get(project_id)
    with closing(connect(paths.database)) as connection:
        ids = connection.execute(
            "SELECT id FROM crop_operations ORDER BY created_at DESC, rowid DESC"
        ).fetchall()
    return [operation(paths.database, str(row[0])) for row in ids]


@router.post(PREFIX + "/operations/{operation_id}/undo", response_model=CropOperation)
def undo(project_id: str, operation_id: str, container: Container) -> CropOperation:
    return execution.undo(container, project_id, operation_id)


@router.get(PREFIX + "/sources/{output_id}", response_model=CropProvenance | None)
def crop_source(project_id: str, output_id: str, container: Container) -> CropProvenance | None:
    paths, _ = container.workspaces.get(project_id)
    return provenance(paths.database, output_id)
