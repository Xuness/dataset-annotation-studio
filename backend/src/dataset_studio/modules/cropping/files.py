from __future__ import annotations

import os
import shutil
import sqlite3
from pathlib import Path

from dataset_studio.core.files import file_sha256
from dataset_studio.core.sqlite import transaction
from dataset_studio.modules.cropping.planner import safe_path
from dataset_studio.modules.workspaces.paths import WorkspacePaths


def staging_path(paths: WorkspacePaths, output_id: str, relative: str) -> Path:
    output = safe_path(paths.root, relative)
    return output.with_name(f".dataset-studio-crop-{output_id}.tmp")


def remember_identity(database: Path, output_id: str, identity: os.stat_result) -> None:
    with transaction(database) as connection:
        connection.execute(
            "UPDATE crop_outputs SET file_device=?,file_inode=? WHERE id=?",
            (str(identity.st_dev), str(identity.st_ino), output_id),
        )


def owns_file(path: Path, row: sqlite3.Row) -> bool:
    if row["file_device"] is None or row["file_inode"] is None:
        return False
    try:
        identity = path.stat(follow_symlinks=False)
    except FileNotFoundError:
        return False
    return (str(identity.st_dev), str(identity.st_ino)) == (
        row["file_device"],
        row["file_inode"],
    )


def cleanup_staging(paths: WorkspacePaths, row: sqlite3.Row) -> None:
    staged = staging_path(paths, str(row["id"]), str(row["relative_path"]))
    if owns_file(staged, row):
        staged.unlink()


def publish_copy(
    paths: WorkspacePaths, output_id: str, relative: str, source: Path, expected_hash: str
) -> None:
    """Publish exclusively on the destination volume, journaling identity before linking."""
    output = safe_path(paths.root, relative)
    output.parent.mkdir(parents=True, exist_ok=True)
    staged = staging_path(paths, output_id, relative)
    identity: os.stat_result | None = None
    try:
        with staged.open("xb") as target:
            identity = os.fstat(target.fileno())
            remember_identity(paths.database, output_id, identity)
            with source.open("rb") as original:
                shutil.copyfileobj(original, target, length=1024 * 1024)
            target.flush()
            os.fsync(target.fileno())
        if file_sha256(staged) != expected_hash:
            raise ValueError(f"裁剪发布副本校验失败：{relative}")
        # Both paths are beside the final output even when recovery is on another disk.
        output = safe_path(paths.root, relative)
        os.link(staged, output)
    finally:
        if identity is not None and staged.exists():
            current = staged.stat(follow_symlinks=False)
            if (current.st_dev, current.st_ino) == (identity.st_dev, identity.st_ino):
                staged.unlink()
