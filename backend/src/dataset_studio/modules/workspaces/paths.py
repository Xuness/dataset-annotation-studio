from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from uuid import UUID

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
        """Locate an embedded legacy workspace for migration only."""
        internal = root / settings.workspace_dir_name
        return cls.from_locations(root, internal)

    @classmethod
    def for_project(cls, root: Path, settings: Settings, project_id: str) -> WorkspacePaths:
        internal = settings.app_data_dir / "workspaces" / str(UUID(project_id))
        return cls.from_locations(root, internal)

    @classmethod
    def from_locations(cls, root: Path, internal: Path) -> WorkspacePaths:
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
