from __future__ import annotations

from pathlib import Path

from dataset_studio.core.migrations import Migration, migrate_database

GLOBAL_SCHEMA = """
CREATE TABLE IF NOT EXISTS recent_workspaces (
    project_id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    root_path TEXT NOT NULL,
    created_at TEXT NOT NULL,
    last_opened_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS system_presets (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    system_prompt TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS provider_profiles (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    provider_type TEXT NOT NULL,
    base_url TEXT NOT NULL,
    model TEXT NOT NULL,
    temperature REAL NOT NULL,
    max_output_tokens INTEGER NOT NULL,
    concurrency INTEGER NOT NULL,
    timeout_seconds INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
"""

GLOBAL_SCHEMA_VERSION = 1
GLOBAL_MIGRATIONS = (Migration(1, "initial_global_schema", GLOBAL_SCHEMA),)


def initialize_global_database(database_path: Path) -> None:
    migrate_database(database_path, GLOBAL_MIGRATIONS)
