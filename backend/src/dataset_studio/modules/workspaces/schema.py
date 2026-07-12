from __future__ import annotations

from pathlib import Path

from dataset_studio.core.migrations import Migration, migrate_database

WORKSPACE_SCHEMA = """
CREATE TABLE IF NOT EXISTS assets (
    id TEXT PRIMARY KEY,
    relative_path TEXT NOT NULL UNIQUE,
    filename TEXT NOT NULL,
    stem TEXT NOT NULL,
    suffix TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    byte_size INTEGER NOT NULL,
    modified_ns INTEGER NOT NULL,
    width INTEGER NOT NULL,
    height INTEGER NOT NULL,
    annotation_relative_path TEXT NOT NULL,
    annotation_status TEXT NOT NULL,
    annotation_modified_ns INTEGER,
    metadata_relative_path TEXT,
    is_present INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_assets_present_path
ON assets(is_present, relative_path);

CREATE INDEX IF NOT EXISTS idx_assets_annotation_status
ON assets(is_present, annotation_status);

CREATE INDEX IF NOT EXISTS idx_assets_content_hash
ON assets(content_hash);

CREATE TABLE IF NOT EXISTS annotation_revisions (
    id TEXT PRIMARY KEY,
    asset_id TEXT NOT NULL,
    content TEXT NOT NULL,
    source TEXT NOT NULL,
    validation_status TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY(asset_id) REFERENCES assets(id)
);

CREATE INDEX IF NOT EXISTS idx_annotation_revisions_asset
ON annotation_revisions(asset_id, created_at DESC);

CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY,
    status TEXT NOT NULL,
    system_preset_id TEXT NOT NULL,
    system_prompt_snapshot TEXT NOT NULL,
    provider_profile_id TEXT NOT NULL,
    provider_snapshot TEXT NOT NULL,
    user_prompt_snapshot TEXT NOT NULL,
    json_fields_snapshot TEXT NOT NULL,
    scope TEXT NOT NULL,
    overwrite_existing INTEGER NOT NULL DEFAULT 0,
    retry_limit INTEGER NOT NULL DEFAULT 3,
    stop_requested INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    completed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status, created_at);

CREATE TABLE IF NOT EXISTS job_items (
    id TEXT PRIMARY KEY,
    job_id TEXT NOT NULL,
    asset_id TEXT NOT NULL,
    status TEXT NOT NULL,
    attempt_count INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    validation_status TEXT,
    manually_accepted INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY(job_id) REFERENCES jobs(id),
    FOREIGN KEY(asset_id) REFERENCES assets(id),
    UNIQUE(job_id, asset_id)
);

CREATE INDEX IF NOT EXISTS idx_job_items_job_status
ON job_items(job_id, status);

CREATE TABLE IF NOT EXISTS job_attempts (
    id TEXT PRIMARY KEY,
    job_item_id TEXT NOT NULL,
    attempt_number INTEGER NOT NULL,
    status TEXT NOT NULL,
    response_content TEXT,
    error_message TEXT,
    provider_payload_path TEXT,
    started_at TEXT NOT NULL,
    finished_at TEXT,
    input_tokens INTEGER,
    output_tokens INTEGER,
    finish_reason TEXT,
    FOREIGN KEY(job_item_id) REFERENCES job_items(id)
);

CREATE TABLE IF NOT EXISTS preprocess_operations (
    id TEXT PRIMARY KEY,
    status TEXT NOT NULL,
    options_json TEXT NOT NULL,
    item_count INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    completed_at TEXT,
    undone_at TEXT,
    error_message TEXT
);

CREATE TABLE IF NOT EXISTS preprocess_items (
    id TEXT PRIMARY KEY,
    operation_id TEXT NOT NULL,
    asset_id TEXT NOT NULL,
    before_relative_path TEXT NOT NULL,
    after_relative_path TEXT NOT NULL,
    before_hash TEXT NOT NULL,
    after_hash TEXT NOT NULL,
    before_width INTEGER NOT NULL,
    before_height INTEGER NOT NULL,
    after_width INTEGER NOT NULL,
    after_height INTEGER NOT NULL,
    recovery_relative_path TEXT NOT NULL,
    FOREIGN KEY(operation_id) REFERENCES preprocess_operations(id),
    FOREIGN KEY(asset_id) REFERENCES assets(id)
);

CREATE INDEX IF NOT EXISTS idx_preprocess_items_operation
ON preprocess_items(operation_id);
"""

IMAGE_METADATA_VERSION_MIGRATION = """
ALTER TABLE assets
ADD COLUMN image_metadata_version INTEGER NOT NULL DEFAULT 1;
"""

WORKSPACE_SCHEMA_VERSION = 2
WORKSPACE_MIGRATIONS = (
    Migration(1, "initial_workspace_schema", WORKSPACE_SCHEMA),
    Migration(2, "image_metadata_version", IMAGE_METADATA_VERSION_MIGRATION),
)


def initialize_workspace_database(database_path: Path) -> None:
    migrate_database(database_path, WORKSPACE_MIGRATIONS)
