from __future__ import annotations

import hashlib
import os
import tempfile
from collections.abc import Iterator, Sequence
from contextlib import ExitStack, contextmanager
from pathlib import Path, PurePosixPath

from filelock import FileLock, Timeout
from pydantic import BaseModel

from dataset_studio.core.errors import ResourceConflictError
from dataset_studio.core.files import file_sha256
from dataset_studio.core.paths import filesystem_path_key


class FileFingerprint(BaseModel):
    exists: bool
    content_hash: str | None
    byte_size: int


def safe_target(root: Path, relative: str) -> Path:
    parts = PurePosixPath(relative)
    if parts.is_absolute() or ".." in parts.parts or "\\" in relative or not relative:
        raise ValueError(f"目标相对路径无效：{relative}")
    target = root / Path(parts)
    for parent in (target, *target.parents):
        if parent.is_symlink():
            raise ValueError(f"文件目标不能包含符号链接：{parent}")
        if parent == root:
            break
    if not target.resolve().is_relative_to(root.resolve()):
        raise ValueError(f"目标路径超出目录范围：{target}")
    return target


def fingerprint(target: Path) -> FileFingerprint:
    if target.is_symlink():
        raise ValueError(f"目标不能是符号链接：{target}")
    if not target.exists():
        return FileFingerprint(exists=False, content_hash=None, byte_size=0)
    if not target.is_file():
        raise ValueError(f"目标不是普通文件：{target}")
    stat = target.stat()
    digest = file_sha256(target)
    after = target.stat()
    if (stat.st_size, stat.st_mtime_ns, stat.st_ino) != (
        after.st_size,
        after.st_mtime_ns,
        after.st_ino,
    ):
        raise ValueError(f"读取期间目标发生变化：{target}")
    return FileFingerprint(exists=True, content_hash=digest, byte_size=stat.st_size)


@contextmanager
def hold_file_targets(app_data: Path, targets: Sequence[Path]) -> Iterator[None]:
    directory = app_data / "locks" / "file-targets"
    directory.mkdir(parents=True, exist_ok=True)
    keys = sorted({filesystem_path_key(target) for target in targets})
    with ExitStack() as stack:
        for key in keys:
            name = hashlib.sha256(key.encode("utf-8")).hexdigest()
            try:
                stack.enter_context(FileLock(directory / f"{name}.lock", timeout=0))
            except Timeout as error:
                raise ResourceConflictError(
                    f"文件正被其他操作使用，请等待完成后重新预览：{key}"
                ) from error
        yield


def commit_verified_copy(
    source: Path, target: Path, before: FileFingerprint, expected_hash: str
) -> None:
    """Verify a staged copy before publishing; new targets are created exclusively."""
    target.parent.mkdir(parents=True, exist_ok=True)
    descriptor, name = tempfile.mkstemp(prefix=".dataset-studio-restore-", dir=target.parent)
    temporary = Path(name)
    try:
        digest = hashlib.sha256()
        with os.fdopen(descriptor, "wb") as output, source.open("rb") as input_file:
            while chunk := input_file.read(1024 * 1024):
                digest.update(chunk)
                output.write(chunk)
            output.flush()
            os.fsync(output.fileno())
        if digest.hexdigest() != expected_hash:
            raise ValueError(f"恢复备份在读取期间发生变化：{source}")
        if fingerprint(target) != before:
            raise ValueError(f"恢复提交前目标已变化：{target}")
        if before.exists:
            os.replace(temporary, target)
        else:
            os.link(temporary, target)
    finally:
        temporary.unlink(missing_ok=True)
