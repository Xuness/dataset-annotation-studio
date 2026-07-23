from __future__ import annotations

import hashlib
import json
from dataclasses import asdict, dataclass
from pathlib import Path, PurePosixPath

from dataset_studio.core.files import file_sha256
from dataset_studio.core.paths import relative_path_key
from dataset_studio.modules.assets.companions import (
    AssetBundleFileKind,
    discover_asset_companions,
    path_key,
)
from dataset_studio.modules.assets.deletions.models import AssetDeletionRequest
from dataset_studio.modules.assets.repository import AssetRepository


@dataclass(frozen=True, slots=True)
class DeletionAssetPlan:
    asset_id: str
    relative_path: str
    content_hash: str


@dataclass(frozen=True, slots=True)
class DeletionFilePlan:
    kind: AssetBundleFileKind
    source_relative_path: str
    content_hash: str
    byte_size: int
    modified_ns: int


@dataclass(frozen=True, slots=True)
class AssetDeletionPlan:
    assets: tuple[DeletionAssetPlan, ...]
    files: tuple[DeletionFilePlan, ...]
    shared_sidecar_count: int
    warnings: tuple[str, ...]
    blocking_issues: tuple[str, ...]

    def count(self, kind: AssetBundleFileKind) -> int:
        return sum(file.kind == kind for file in self.files)


def build_plan(
    database_path: Path,
    root: Path,
    internal: Path,
    request: AssetDeletionRequest,
) -> AssetDeletionPlan:
    repository = AssetRepository(database_path)
    requested_ids = request.asset_ids
    selected_rows = repository.get_assets(requested_ids)
    all_rows = repository.list_present_records()
    selected_ids = set(selected_rows)
    warnings: list[str] = []
    blocking_issues: list[str] = []

    missing_ids = [asset_id for asset_id in requested_ids if asset_id not in selected_rows]
    if missing_ids:
        blocking_issues.append(f"{len(missing_ids)} 个所选素材已不在当前工作区，请刷新列表后重试。")

    owners_by_base: dict[str, set[str]] = {}
    for row in all_rows:
        owners_by_base.setdefault(
            _bundle_base(str(row["relative_path"])),
            set(),
        ).add(str(row["id"]))
    claimed_annotations = {
        path_key(root / Path(PurePosixPath(str(row["annotation_relative_path"]))))
        for row in all_rows
    }

    assets: list[DeletionAssetPlan] = []
    files_by_path: dict[str, DeletionFilePlan] = {}
    planned_bases: set[str] = set()
    shared_sidecar_count = 0

    for asset_id in requested_ids:
        row = selected_rows.get(asset_id)
        if row is None:
            continue
        relative_path = str(row["relative_path"])
        assets.append(
            DeletionAssetPlan(
                asset_id=asset_id,
                relative_path=relative_path,
                content_hash=str(row["content_hash"]),
            )
        )
        image_path = root / Path(PurePosixPath(relative_path))
        safe_image = _safe_source(root, internal, image_path, blocking_issues)
        if safe_image is not None:
            _add_image_file(row, safe_image, root, files_by_path, blocking_issues)

        base = _bundle_base(relative_path)
        if base in planned_bases:
            continue
        planned_bases.add(base)
        companions = discover_asset_companions(image_path, claimed_annotations)
        existing_companions = [item for item in companions if item.path.is_file()]
        if not owners_by_base.get(base, set()).issubset(selected_ids):
            shared_sidecar_count += len(existing_companions)
            continue
        for companion in existing_companions:
            safe_companion = _safe_source(root, internal, companion.path, blocking_issues)
            if safe_companion is None:
                continue
            stat = safe_companion.stat()
            relative = safe_companion.relative_to(root).as_posix()
            files_by_path.setdefault(
                relative_path_key(relative),
                DeletionFilePlan(
                    kind=companion.kind,
                    source_relative_path=relative,
                    content_hash=file_sha256(safe_companion),
                    byte_size=stat.st_size,
                    modified_ns=stat.st_mtime_ns,
                ),
            )

    if shared_sidecar_count:
        warnings.append(f"{shared_sidecar_count} 个同名旁车仍被未选中的图片使用，将予以保留。")

    files = tuple(
        sorted(
            files_by_path.values(),
            key=lambda item: (
                item.kind == AssetBundleFileKind.IMAGE,
                item.source_relative_path.casefold(),
                item.source_relative_path,
            ),
        )
    )
    return AssetDeletionPlan(
        assets=tuple(assets),
        files=files,
        shared_sidecar_count=shared_sidecar_count,
        warnings=tuple(warnings),
        blocking_issues=tuple(dict.fromkeys(blocking_issues)),
    )


def preview_token(request: AssetDeletionRequest, plan: AssetDeletionPlan) -> str:
    payload = {
        "asset_ids": request.asset_ids,
        "assets": [asdict(item) for item in plan.assets],
        "files": [{**asdict(item), "kind": item.kind.value} for item in plan.files],
        "shared_sidecar_count": plan.shared_sidecar_count,
        "warnings": plan.warnings,
        "blocking_issues": plan.blocking_issues,
    }
    encoded = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()


def _add_image_file(
    row,
    image_path: Path,
    root: Path,
    files_by_path: dict[str, DeletionFilePlan],
    blocking_issues: list[str],
) -> None:
    relative_path = str(row["relative_path"])
    if not image_path.is_file():
        blocking_issues.append(f"图片已不存在：{relative_path}")
        return
    stat = image_path.stat()
    if stat.st_size != int(row["byte_size"]) or stat.st_mtime_ns != int(row["modified_ns"]):
        blocking_issues.append(f"图片在上次扫描后发生了变化：{relative_path}")
        return
    content_hash = file_sha256(image_path)
    if content_hash != str(row["content_hash"]):
        blocking_issues.append(f"图片内容与工作区索引不一致：{relative_path}")
        return
    relative = image_path.relative_to(root).as_posix()
    files_by_path[relative_path_key(relative)] = DeletionFilePlan(
        kind=AssetBundleFileKind.IMAGE,
        source_relative_path=relative,
        content_hash=content_hash,
        byte_size=stat.st_size,
        modified_ns=stat.st_mtime_ns,
    )


def _safe_source(
    root: Path,
    internal: Path,
    candidate: Path,
    blocking_issues: list[str],
) -> Path | None:
    resolved_root = root.resolve()
    resolved_internal = internal.resolve()
    resolved = candidate.resolve()
    if not resolved.is_relative_to(resolved_root) or resolved == resolved_internal:
        blocking_issues.append(f"文件路径超出当前工作区：{candidate}")
        return None
    if resolved.is_relative_to(resolved_internal):
        blocking_issues.append(f"拒绝删除工作区内部文件：{candidate}")
        return None
    return candidate


def _bundle_base(relative_path: str) -> str:
    return relative_path_key(PurePosixPath(relative_path).with_suffix(""))
