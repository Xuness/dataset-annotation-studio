from __future__ import annotations

import json
import os
import shutil
import sqlite3
import uuid
from dataclasses import dataclass
from pathlib import Path

from dataset_studio.core.config import Settings
from dataset_studio.core.files import atomic_copy_file_with_sha256, file_sha256
from dataset_studio.core.paths import filesystem_path_key
from dataset_studio.core.sqlite import connect, transaction
from dataset_studio.modules.workspaces.models import WorkspaceManifest
from dataset_studio.modules.workspaces.paths import WorkspacePaths


@dataclass(frozen=True, slots=True)
class WorkspaceLocation:
    project_id: str
    root_path: Path
    directory_identity: str | None
    attached: bool
    storage_version: int


def directory_identity(root: Path) -> str:
    stat = root.stat()
    return f"{stat.st_dev}:{stat.st_ino}"


def locations(database: Path) -> list[WorkspaceLocation]:
    connection = connect(database)
    try:
        return [
            WorkspaceLocation(
                project_id=str(row["project_id"]),
                root_path=Path(str(row["root_path"])),
                directory_identity=row["directory_identity"],
                attached=bool(row["attached"]),
                storage_version=int(row["storage_version"]),
            )
            for row in connection.execute("SELECT * FROM workspace_locations").fetchall()
        ]
    finally:
        connection.close()


def validate_root(settings: Settings, root: Path) -> None:
    if not root.is_dir():
        raise ValueError(f"数据集文件夹不存在：{root}")
    app = settings.app_data_dir.resolve()
    if root.is_relative_to(app) or app.is_relative_to(root):
        raise ValueError(f"数据集与工具数据目录不能相互包含：{root}；{app}")
    if settings.workspace_dir_name in root.parts:
        raise ValueError(f"不能打开旧工作区备份作为数据集：{root}")


def validate_association(database: Path, root: Path, project_id: str, identity: str) -> None:
    key = filesystem_path_key(root)
    for location in locations(database):
        if not location.attached or location.project_id == project_id:
            continue
        other = filesystem_path_key(location.root_path)
        if (
            key == other
            or key.startswith(other.rstrip("/") + "/")
            or other.startswith(key.rstrip("/") + "/")
            or identity == location.directory_identity
        ):
            raise ValueError(
                f"数据集目录与已关联项目重叠：{location.root_path}"
                f"（{location.project_id}）；请使用该项目子集或先解除目录关联。"
            )


def save_location(database: Path, root: Path, project_id: str) -> None:
    identity = directory_identity(root)
    validate_association(database, root, project_id, identity)
    with transaction(database) as connection:
        connection.execute(
            """
            INSERT INTO workspace_locations (
                project_id, root_path, root_path_key, directory_identity, storage_version
            ) VALUES (?, ?, ?, ?, 1)
            ON CONFLICT(project_id) DO UPDATE SET
                root_path=excluded.root_path, root_path_key=excluded.root_path_key,
                directory_identity=excluded.directory_identity, attached=1, storage_version=1
            """,
            (project_id, str(root), filesystem_path_key(root), identity),
        )


def choose_project(settings: Settings, root: Path, independent_copy: bool) -> str:
    database = settings.app_data_dir / "global.sqlite3"
    identity = directory_identity(root)
    for location in locations(database):
        if not location.attached:
            continue
        if filesystem_path_key(location.root_path) == filesystem_path_key(root):
            if location.directory_identity not in (None, identity):
                raise ValueError("该路径的目录身份已改变，请从原项目重新定位数据集。")
            validate_association(database, root, location.project_id, identity)
            return location.project_id
        if identity == location.directory_identity:
            raise ValueError(f"此数据集属于项目 {location.project_id}，请通过重新定位更新路径。")
    legacy = WorkspacePaths.from_root(root, settings)
    project_id = str(uuid.uuid4())
    if legacy.manifest.is_file() and not independent_copy:
        manifest = WorkspaceManifest.model_validate_json(legacy.manifest.read_text("utf-8"))
        project_id = str(uuid.UUID(manifest.project_id))
        if any(item.project_id == project_id for item in locations(database)):
            raise ValueError(
                f"旧工作区 ID 已登记：{project_id}；请重新关联该项目或选择独立副本导入。"
            )
    validate_association(database, root, project_id, identity)
    return project_id


def migrate_embedded(settings: Settings, root: Path, project_id: str) -> bool:
    """Publish a verified copy; never mutate the embedded source workspace."""
    legacy = WorkspacePaths.from_root(root, settings)
    destination = WorkspacePaths.for_project(root, settings, project_id)
    if destination.manifest.is_file() or not legacy.manifest.is_file():
        return False
    manifest = WorkspaceManifest.model_validate_json(legacy.manifest.read_text("utf-8"))
    staging = destination.internal.with_name(f".{project_id}.migrating")
    if staging.exists():
        shutil.rmtree(staging)
    staging.mkdir(parents=True)
    if legacy.database.exists():
        _copy_database(legacy.database, staging / "state.sqlite3")
    for source in sorted(legacy.internal.rglob("*")):
        relative = source.relative_to(legacy.internal)
        if source.is_symlink():
            raise ValueError(f"旧工作区包含符号链接，迁移已停止：{source}")
        if source.is_file() and relative.as_posix() not in {
            "state.sqlite3",
            "state.sqlite3-wal",
            "state.sqlite3-shm",
            "project.json",
        }:
            before = file_sha256(source)
            copied = atomic_copy_file_with_sha256(source, staging / relative)
            if before != copied or copied != file_sha256(source):
                raise ValueError(f"旧工作区文件复制校验失败或源文件已改变：{source}")
    (staging / "project.json").write_text(
        manifest.model_copy(update={"project_id": project_id}).model_dump_json(indent=2),
        encoding="utf-8",
    )
    (staging / "migration.json").write_text(
        json.dumps({"source": str(legacy.internal), "status": "verified"}), encoding="utf-8"
    )
    if destination.internal.exists():
        raise ValueError(f"集中工作区已存在但缺少有效清单，拒绝覆盖：{destination.internal}")
    os.rename(staging, destination.internal)
    return True


def _copy_database(source: Path, destination: Path) -> None:
    original = sqlite3.connect(f"{source.as_uri()}?mode=ro", uri=True)
    target = sqlite3.connect(destination)
    try:
        tables = {row[0] for row in original.execute("SELECT name FROM sqlite_master")}
        for table in (
            "jobs",
            "export_operations",
            "preprocess_operations",
            "asset_delete_operations",
            "screening_operations",
        ):
            if table in tables:
                active = original.execute(
                    f"SELECT COUNT(*) FROM {table} "
                    "WHERE status IN ('queued', 'running', 'stopping', 'recovering')"
                ).fetchone()[0]
                if active:
                    raise ValueError(f"旧工作区仍有活动任务，请先停止后迁移：{table}")
        original.backup(target)
        if target.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
            raise ValueError(f"工作区数据库迁移校验失败：{source}")
        if target.execute("PRAGMA foreign_key_check").fetchall():
            raise ValueError(f"工作区数据库存在无效关联：{source}")
    finally:
        target.close()
        original.close()
