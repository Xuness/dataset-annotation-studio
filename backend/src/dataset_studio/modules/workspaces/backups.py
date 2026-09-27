from __future__ import annotations

import hashlib
import json
import secrets
import uuid
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, Field

from dataset_studio.core.file_targets import (
    FileFingerprint,
    commit_verified_copy,
    fingerprint,
    safe_target,
)
from dataset_studio.core.files import atomic_copy_file_with_sha256, file_sha256
from dataset_studio.core.sqlite import connect, transaction
from dataset_studio.core.time import utc_now_iso
from dataset_studio.modules.workspaces.paths import WorkspacePaths


class OriginalFile(BaseModel):
    id: str
    asset_id: str
    role: str
    source_relative_path: str
    backup_relative_path: str
    content_hash: str
    byte_size: int
    created_at: str
    available: bool


class RestoreRequest(BaseModel):
    backup_ids: list[str] = Field(min_length=1)
    destination_kind: Literal["source", "directory"]
    destination_path: str | None
    allow_replace: bool


class RestoreItem(BaseModel):
    backup: OriginalFile
    target_path: str
    before: FileFingerprint
    action: Literal["create", "reuse", "replace", "blocked"]


class RestorePreview(BaseModel):
    items: list[RestoreItem]
    blocking_issues: list[str]
    preview_token: str


class RestoreExecution(BaseModel):
    request: RestoreRequest
    preview_token: str


def index_existing_originals(paths: WorkspacePaths) -> None:
    """Recover known pre-edit image versions without claiming current bytes as originals."""
    connection = connect(paths.database)
    try:
        rows = connection.execute("""
            SELECT i.asset_id, i.before_relative_path AS relative_path,
                   i.recovery_relative_path, i.before_hash AS content_hash, o.created_at
            FROM preprocess_items i JOIN preprocess_operations o ON o.id=i.operation_id
            WHERE o.status IN ('completed','undone')
            UNION ALL
            SELECT i.asset_id, i.relative_path, f.recovery_relative_path,
                   f.content_hash, o.created_at
            FROM asset_delete_items i
            JOIN asset_delete_operations o ON o.id=i.operation_id
            JOIN asset_delete_files f ON f.operation_id=o.id
                AND f.source_relative_path=i.relative_path AND f.kind='image'
            WHERE o.status IN ('completed','undone')
            ORDER BY created_at
        """).fetchall()
    finally:
        connection.close()
    connection = connect(paths.database)
    try:
        seen = {
            str(item["asset_id"])
            for item in connection.execute("SELECT asset_id FROM original_files WHERE role='image'")
        }
    finally:
        connection.close()
    for row in rows:
        asset_id = str(row["asset_id"])
        if asset_id in seen:
            continue
        seen.add(asset_id)
        source = safe_target(paths.internal, str(row["recovery_relative_path"]))
        relative = str(row["relative_path"])
        expected = str(row["content_hash"])
        current = safe_target(paths.root, relative)
        if source.is_file() and file_sha256(source) == expected:
            preserve_original(paths, asset_id, "image", relative, source)
        elif current.is_file() and file_sha256(current) == expected:
            preserve_original(paths, asset_id, "image", relative, current)
        else:
            with transaction(paths.database) as connection:
                connection.execute(
                    "INSERT OR IGNORE INTO original_files VALUES (?, ?, 'image', ?, ?, ?, 0, ?)",
                    (
                        str(uuid.uuid4()),
                        asset_id,
                        relative,
                        str(row["recovery_relative_path"]),
                        expected,
                        str(row["created_at"]),
                    ),
                )


def preserve_asset_files(paths: WorkspacePaths, asset_id: str, image: Path) -> None:
    from dataset_studio.modules.assets.companions import (
        discover_asset_companions,
        registered_suffixes,
    )

    preserve_original(paths, asset_id, "image", image.relative_to(paths.root).as_posix(), image)
    for suffix in registered_suffixes(paths.database, paths.root, (image,)):
        companion = image.with_name(image.stem + suffix)
        if companion.is_file():
            preserve_original(
                paths,
                asset_id,
                f"companion:{suffix}",
                companion.relative_to(paths.root).as_posix(),
                companion,
            )
    for companion in discover_asset_companions(image, set()):
        if companion.path.is_file():
            suffix = companion.path.name[len(image.stem) :]
            preserve_original(
                paths,
                asset_id,
                f"companion:{suffix}",
                companion.path.relative_to(paths.root).as_posix(),
                companion.path,
            )


def preserve_original(
    paths: WorkspacePaths, asset_id: str, role: str, relative: str, source: Path
) -> None:
    with transaction(paths.database) as connection:
        existing = connection.execute(
            "SELECT backup_relative_path, content_hash FROM original_files "
            "WHERE asset_id=? AND role=?",
            (asset_id, role),
        ).fetchone()
        if existing:
            saved = safe_target(paths.internal, str(existing["backup_relative_path"]))
            if not saved.is_file() or file_sha256(saved) != str(existing["content_hash"]):
                raise ValueError(f"原始备份缺失或损坏，停止修改：{saved}")
            return
        observed = fingerprint(source)
        if not observed.exists:
            raise ValueError(f"无法备份不存在的原文件：{source}")
        backup_id = str(uuid.uuid4())
        backup = paths.recovery / "originals" / backup_id / source.name
        copied = atomic_copy_file_with_sha256(source, backup)
        if copied != observed.content_hash or fingerprint(source) != observed:
            raise ValueError(f"原始文件备份校验失败，源文件未修改：{source}")
        connection.execute(
            """INSERT INTO original_files VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                backup_id,
                asset_id,
                role,
                relative,
                backup.relative_to(paths.internal).as_posix(),
                copied,
                observed.byte_size,
                utc_now_iso(),
            ),
        )


def list_originals(paths: WorkspacePaths) -> list[OriginalFile]:
    connection = connect(paths.database)
    try:
        rows = connection.execute("SELECT * FROM original_files ORDER BY created_at, id").fetchall()
        return [
            OriginalFile.model_validate(
                {
                    **dict(row),
                    "available": safe_target(
                        paths.internal, str(row["backup_relative_path"])
                    ).is_file(),
                }
            )
            for row in rows
        ]
    finally:
        connection.close()


def restore_preview(paths: WorkspacePaths, request: RestoreRequest) -> RestorePreview:
    if len(request.backup_ids) != len(set(request.backup_ids)):
        raise ValueError("不能重复选择相同备份。")
    if request.destination_kind == "source":
        root = paths.root
    elif request.destination_path:
        root = Path(request.destination_path).expanduser().resolve()
    else:
        raise ValueError("请选择恢复目标目录。")
    if not root.is_dir():
        raise ValueError(f"恢复目标目录不存在：{root}")
    if request.destination_kind == "directory" and root.is_relative_to(paths.root):
        raise ValueError("恢复到当前数据集内时，请选择原始位置并重新预览。")
    if root.is_relative_to(paths.internal.parents[1]) or ".annotation-workspace" in root.parts:
        raise ValueError("不能恢复到工具状态或旧工作区备份目录。")
    available = {item.id: item for item in list_originals(paths)}
    items: list[RestoreItem] = []
    issues: list[str] = []
    targets: set[str] = set()
    for backup_id in request.backup_ids:
        backup = available.get(backup_id)
        if backup is None:
            raise ValueError(f"备份不存在：{backup_id}")
        source = safe_target(paths.internal, backup.backup_relative_path)
        if not source.is_file() or file_sha256(source) != backup.content_hash:
            issues.append(f"备份缺失或损坏：{backup.source_relative_path}")
        target = safe_target(root, backup.source_relative_path)
        if (
            target.is_relative_to(paths.internal.parents[1])
            or ".annotation-workspace" in target.parts
        ):
            raise ValueError(f"恢复产物不能写入工具数据或旧工作区备份：{target}")
        before = fingerprint(target)
        action = "create"
        if before.exists:
            action = "reuse" if before.content_hash == backup.content_hash else "blocked"
            if (
                action == "blocked"
                and request.destination_kind == "source"
                and request.allow_replace
            ):
                action = "replace"
        key = str(target).casefold()
        if key in targets:
            action = "blocked"
        targets.add(key)
        if action == "blocked":
            issues.append(f"恢复目标内容冲突：{target}")
        items.append(
            RestoreItem(backup=backup, target_path=str(target), before=before, action=action)
        )
    payload = json.dumps(
        {"request": request.model_dump(), "items": [item.model_dump() for item in items]},
        sort_keys=True,
    )
    return RestorePreview(
        items=items,
        blocking_issues=issues,
        preview_token=hashlib.sha256(payload.encode()).hexdigest(),
    )


def restore_files(paths: WorkspacePaths, execution: RestoreExecution) -> str:
    preview = restore_preview(paths, execution.request)
    if not secrets.compare_digest(preview.preview_token, execution.preview_token):
        raise ValueError("恢复预览已失效，请重新预览。")
    if preview.blocking_issues:
        raise ValueError("；".join(preview.blocking_issues))
    operation_id = str(uuid.uuid4())
    with transaction(paths.database) as connection:
        connection.execute(
            "INSERT INTO file_restore_operations (id,status,plan_json,created_at) "
            "VALUES (?,'running',?,?)",
            (operation_id, preview.model_dump_json(), utc_now_iso()),
        )
    completed: list[str] = []
    try:
        for item in preview.items:
            target = Path(item.target_path)
            if fingerprint(target) != item.before:
                raise ValueError(f"恢复目标已被外部修改：{target}")
            if item.action == "replace":
                backup = paths.recovery / "restores" / operation_id / item.backup.id / target.name
                copied = atomic_copy_file_with_sha256(target, backup)
                if copied != item.before.content_hash or fingerprint(target) != item.before:
                    raise ValueError(f"恢复前备份失败或目标变化：{target}")
            if item.action != "reuse":
                source = safe_target(paths.internal, item.backup.backup_relative_path)
                if file_sha256(source) != item.backup.content_hash:
                    raise ValueError(f"恢复备份在执行期间变化：{source}")
                commit_verified_copy(source, target, item.before, item.backup.content_hash)
            completed.append(item.backup.id)
            with transaction(paths.database) as connection:
                connection.execute(
                    "UPDATE file_restore_operations SET completed_json=? WHERE id=?",
                    (json.dumps(completed), operation_id),
                )
        with transaction(paths.database) as connection:
            connection.execute(
                "UPDATE file_restore_operations SET status='completed' WHERE id=?", (operation_id,)
            )
    except Exception as error:
        with transaction(paths.database) as connection:
            connection.execute(
                "UPDATE file_restore_operations SET status='failed',error_message=? WHERE id=?",
                (str(error), operation_id),
            )
        raise
    return operation_id
