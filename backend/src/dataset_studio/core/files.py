from __future__ import annotations

import hashlib
import os
import shutil
import tempfile
from pathlib import Path


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while chunk := handle.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def atomic_write_text(path: Path, content: str, *, encoding: str = "utf-8") -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    file_descriptor, temporary_name = tempfile.mkstemp(
        prefix=f".{path.name}.", suffix=".tmp", dir=path.parent
    )
    temporary_path = Path(temporary_name)
    try:
        with os.fdopen(file_descriptor, "w", encoding=encoding, newline="\n") as handle:
            handle.write(content)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary_path, path)
    except BaseException:
        temporary_path.unlink(missing_ok=True)
        raise


def atomic_copy_file(source: Path, target: Path) -> None:
    """Copy a file without ever exposing a partially written target."""

    _atomic_copy_file(source, target, calculate_sha256=False)


def atomic_copy_file_with_sha256(source: Path, target: Path) -> str:
    """Atomically copy a file and return the digest calculated during that copy."""

    digest = _atomic_copy_file(source, target, calculate_sha256=True)
    if digest is None:
        raise RuntimeError("复制文件时未能计算 SHA-256。")
    return digest


def _atomic_copy_file(
    source: Path,
    target: Path,
    *,
    calculate_sha256: bool,
) -> str | None:
    target.parent.mkdir(parents=True, exist_ok=True)
    file_descriptor, temporary_name = tempfile.mkstemp(
        prefix=f".{target.name}.", suffix=".copy", dir=target.parent
    )
    temporary_path = Path(temporary_name)
    digest = hashlib.sha256() if calculate_sha256 else None
    try:
        with os.fdopen(file_descriptor, "wb") as target_handle, source.open("rb") as source_handle:
            while chunk := source_handle.read(1024 * 1024):
                if digest is not None:
                    digest.update(chunk)
                target_handle.write(chunk)
            target_handle.flush()
            os.fsync(target_handle.fileno())
        shutil.copystat(source, temporary_path)
        os.replace(temporary_path, target)
    except BaseException:
        temporary_path.unlink(missing_ok=True)
        raise
    return digest.hexdigest() if digest is not None else None
