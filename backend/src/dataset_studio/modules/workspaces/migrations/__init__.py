"""Immutable, versioned workspace database migrations."""

from dataset_studio.modules.workspaces.migrations.registry import (
    WORKSPACE_MIGRATIONS,
    WORKSPACE_SCHEMA_VERSION,
)

__all__ = ["WORKSPACE_MIGRATIONS", "WORKSPACE_SCHEMA_VERSION"]
