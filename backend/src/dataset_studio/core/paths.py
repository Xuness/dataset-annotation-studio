from __future__ import annotations

import os
from pathlib import Path, PurePosixPath


def platform_paths_are_case_sensitive() -> bool:
    """Return the path identity policy used by the current runtime.

    Windows path identity is case-insensitive. POSIX runtimes keep case so
    Linux files such as ``image.png`` and ``Image.png`` remain distinct.
    """

    return os.name != "nt"


def filesystem_path_key(
    path: Path,
    *,
    case_sensitive: bool | None = None,
) -> str:
    normalized = path.resolve(strict=False).as_posix()
    return _apply_case_policy(normalized, case_sensitive)


def relative_path_key(
    value: str | PurePosixPath,
    *,
    case_sensitive: bool | None = None,
) -> str:
    normalized = PurePosixPath(value).as_posix()
    return _apply_case_policy(normalized, case_sensitive)


def _apply_case_policy(value: str, case_sensitive: bool | None) -> str:
    sensitive = platform_paths_are_case_sensitive() if case_sensitive is None else case_sensitive
    return value if sensitive else value.casefold()
