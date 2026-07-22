from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Protocol


@dataclass(frozen=True, slots=True)
class TaggerRemoteFile:
    """One immutable file declared by a future audited remote install plan."""

    remote_path: str
    relative_path: str
    sha256: str | None = None


@dataclass(frozen=True, slots=True)
class TaggerDownloadPlan:
    """Adapter-owned plan; no generic repository-layout assumptions are allowed."""

    adapter_id: str
    source_id: str
    revision: str
    files: tuple[TaggerRemoteFile, ...]


class TaggerModelSource(Protocol):
    """Future source implementations materialize a reviewed plan into staging."""

    source_type: str

    def materialize(self, plan: TaggerDownloadPlan, destination: Path) -> None: ...
