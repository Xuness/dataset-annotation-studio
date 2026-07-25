from __future__ import annotations

from pathlib import Path

from dataset_studio.core.migrations import migrate_database
from dataset_studio.modules.workspaces.migrations import (
    WORKSPACE_MIGRATIONS,
    WORKSPACE_SCHEMA_VERSION,
)

__all__ = [
    "WORKSPACE_MIGRATIONS",
    "WORKSPACE_SCHEMA_VERSION",
    "initialize_workspace_database",
]


def initialize_workspace_database(database_path: Path) -> None:
    """Bring a workspace database to the current immutable schema version."""

    migrate_database(database_path, WORKSPACE_MIGRATIONS)
