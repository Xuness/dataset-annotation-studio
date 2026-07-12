from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from dataset_studio.core.config import Settings


@dataclass(frozen=True, slots=True)
class WorkspacePaths:
    root: Path
    internal: Path
    manifest: Path
    database: Path
    recovery: Path
    runs: Path
    history: Path
    validation: Path
    thumbnails: Path

    @classmethod
    def from_root(cls, root: Path, settings: Settings) -> WorkspacePaths:
        internal = root / settings.workspace_dir_name
        return cls(
            root=root,
            internal=internal,
            manifest=internal / "project.json",
            database=internal / "state.sqlite3",
            recovery=internal / "recovery",
            runs=internal / "runs",
            history=internal / "history",
            validation=internal / "validation",
            thumbnails=internal / "cache" / "thumbnails",
        )

    def ensure_directories(self) -> None:
        for directory in (
            self.internal,
            self.recovery,
            self.runs,
            self.history,
            self.validation,
            self.thumbnails,
        ):
            directory.mkdir(parents=True, exist_ok=True)
