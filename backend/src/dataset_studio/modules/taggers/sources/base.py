from __future__ import annotations

import re
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from typing import Protocol

_SHA256 = re.compile(r"^[0-9a-f]{64}$")
_REVISION = re.compile(r"^[0-9a-f]{40}$")
_PLAN_ID = re.compile(r"^[0-9A-Za-z][0-9A-Za-z._:-]{2,119}$")
_LICENSE_ID = re.compile(r"^[0-9A-Za-z][0-9A-Za-z.+-]{1,63}$")


def _safe_relative_path(value: str, label: str) -> str:
    path = PurePosixPath(value)
    if (
        not value
        or "\\" in value
        or path.is_absolute()
        or any(part in {"", ".", ".."} for part in path.parts)
    ):
        raise ValueError(f"{label}必须是安全的 POSIX 相对路径：{value}")
    return path.as_posix()


@dataclass(frozen=True, slots=True)
class TaggerRemoteFile:
    """One immutable file declared by an audited remote install plan."""

    remote_path: str
    relative_path: str
    size: int
    sha256: str

    def __post_init__(self) -> None:
        object.__setattr__(
            self,
            "remote_path",
            _safe_relative_path(self.remote_path, "远程模型文件路径"),
        )
        object.__setattr__(
            self,
            "relative_path",
            _safe_relative_path(self.relative_path, "本地模型文件路径"),
        )
        if self.size < 1:
            raise ValueError("远程模型文件大小必须大于零。")
        normalized_hash = self.sha256.casefold()
        if not _SHA256.fullmatch(normalized_hash):
            raise ValueError(f"远程模型文件缺少有效 SHA-256：{self.relative_path}")
        object.__setattr__(self, "sha256", normalized_hash)


@dataclass(frozen=True, slots=True)
class TaggerDownloadPlan:
    """Adapter-owned plan; generic repository-layout assumptions are forbidden."""

    plan_id: str
    adapter_id: str
    name: str
    model_version: str
    description: str
    source_id: str
    revision: str
    source_url: str
    license_id: str
    license_url: str
    gated: bool
    provenance: str
    files: tuple[TaggerRemoteFile, ...]

    def __post_init__(self) -> None:
        if not _PLAN_ID.fullmatch(self.plan_id):
            raise ValueError(f"打标器下载计划 ID 无效：{self.plan_id}")
        if not self.adapter_id.strip() or not self.name.strip() or not self.model_version.strip():
            raise ValueError("打标器下载计划缺少适配器、名称或版本。")
        if "/" not in self.source_id or self.source_id.startswith(("/", ".")):
            raise ValueError(f"Hugging Face 仓库 ID 无效：{self.source_id}")
        normalized_revision = self.revision.casefold()
        if not _REVISION.fullmatch(normalized_revision):
            raise ValueError("打标器下载计划必须固定到完整的 40 位 commit revision。")
        object.__setattr__(self, "revision", normalized_revision)
        if not self.source_url.startswith("https://huggingface.co/"):
            raise ValueError("打标器下载计划来源必须是 Hugging Face HTTPS 地址。")
        if not _LICENSE_ID.fullmatch(self.license_id):
            raise ValueError(f"打标器下载计划许可证标识无效：{self.license_id}")
        if not self.license_url.startswith("https://huggingface.co/"):
            raise ValueError("打标器下载计划许可证地址必须是 Hugging Face HTTPS 地址。")
        if self.provenance not in {"author", "community"}:
            raise ValueError(f"打标器下载计划来源类型无效：{self.provenance}")
        if not self.files:
            raise ValueError("打标器下载计划至少需要一个文件。")
        remote_paths = [file.remote_path.casefold() for file in self.files]
        relative_paths = [file.relative_path.casefold() for file in self.files]
        if len(remote_paths) != len(set(remote_paths)):
            raise ValueError("打标器下载计划包含重复的远程文件路径。")
        if len(relative_paths) != len(set(relative_paths)):
            raise ValueError("打标器下载计划包含重复的本地文件路径。")

    @property
    def download_size(self) -> int:
        return sum(file.size for file in self.files)


@dataclass(frozen=True, slots=True)
class TaggerTransferProgress:
    relative_path: str
    bytes_downloaded: int
    bytes_total: int
    files_completed: int
    files_total: int


@dataclass(frozen=True, slots=True)
class TaggerMaterializedFile:
    relative_path: str
    size: int
    modified_ns: int
    sha256: str


@dataclass(frozen=True, slots=True)
class TaggerMaterializedModel:
    directory: Path
    files: tuple[TaggerMaterializedFile, ...]


TaggerProgressCallback = Callable[[TaggerTransferProgress], None]
TaggerStopCheck = Callable[[], bool]


class TaggerDownloadStopped(Exception):
    """Raised cooperatively while preserving resumable download state."""


class TaggerSourceError(Exception):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


class TaggerModelSource(Protocol):
    """Materialize an audited plan into private staging."""

    source_type: str

    def preflight(self, plan: TaggerDownloadPlan) -> None: ...

    def materialize(
        self,
        plan: TaggerDownloadPlan,
        destination: Path,
        *,
        on_progress: TaggerProgressCallback,
        should_stop: TaggerStopCheck,
    ) -> TaggerMaterializedModel: ...
