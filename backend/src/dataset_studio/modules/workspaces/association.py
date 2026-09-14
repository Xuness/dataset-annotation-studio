from __future__ import annotations

import hashlib
import json
import secrets
from pathlib import Path

from pydantic import BaseModel

from dataset_studio.core.files import file_sha256
from dataset_studio.core.sqlite import connect, transaction
from dataset_studio.modules.workspaces.service import WorkspaceService
from dataset_studio.modules.workspaces.storage import (
    directory_identity,
    save_location,
    validate_association,
    validate_root,
)


class RelocateRequest(BaseModel):
    path: str


class RelocatePreview(BaseModel):
    path: str
    matched: int
    changed: int
    missing: int
    preview_token: str


class RelocateExecution(BaseModel):
    request: RelocateRequest
    preview_token: str


def preview_relocation(
    workspaces: WorkspaceService, project_id: str, request: RelocateRequest
) -> RelocatePreview:
    paths = workspaces.stored_paths(project_id)
    root = Path(request.path).expanduser().resolve()
    settings = workspaces.settings
    validate_root(settings, root)
    validate_association(
        settings.app_data_dir / "global.sqlite3", root, project_id, directory_identity(root)
    )
    connection = connect(paths.database)
    matched = changed = missing = 0
    snapshots: list[tuple[str, str | None]] = []
    try:
        for row in connection.execute(
            "SELECT relative_path,content_hash FROM assets "
            "WHERE is_present=1 ORDER BY relative_path"
        ):
            relative = str(row["relative_path"])
            target = root / relative
            if target.is_symlink() or not target.resolve().is_relative_to(root):
                raise ValueError(f"重新定位的素材包含不安全路径：{target}")
            digest = file_sha256(target) if target.is_file() else None
            snapshots.append((relative, digest))
            if digest is None:
                missing += 1
            elif digest == str(row["content_hash"]):
                matched += 1
            else:
                changed += 1
    finally:
        connection.close()
    payload = json.dumps([project_id, str(root), directory_identity(root), snapshots])
    return RelocatePreview(
        path=str(root),
        matched=matched,
        changed=changed,
        missing=missing,
        preview_token=hashlib.sha256(payload.encode()).hexdigest(),
    )


def relocate(workspaces: WorkspaceService, project_id: str, execution: RelocateExecution) -> None:
    preview = preview_relocation(workspaces, project_id, execution.request)
    if not secrets.compare_digest(preview.preview_token, execution.preview_token):
        raise ValueError("重新定位预览已失效，请重新检查。")
    paths = workspaces.stored_paths(project_id)
    with transaction(paths.database) as connection:
        for table in ("export_operations", "preprocess_operations", "asset_delete_operations"):
            connection.execute(
                f"UPDATE {table} SET status='failed',error_message=? "
                "WHERE status IN ('stopped','interrupted')",
                ("数据集已重新定位，请重新创建操作。",),
            )
    save_location(
        workspaces.settings.app_data_dir / "global.sqlite3", Path(preview.path), project_id
    )
    workspaces.refresh_association(project_id)


def detach(workspaces: WorkspaceService, project_id: str) -> None:
    workspaces.stored_paths(project_id)
    with transaction(workspaces.settings.app_data_dir / "global.sqlite3") as connection:
        connection.execute(
            "UPDATE workspace_locations SET attached=0 WHERE project_id=?", (project_id,)
        )
