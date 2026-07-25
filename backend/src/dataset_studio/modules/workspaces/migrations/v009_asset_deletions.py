from __future__ import annotations

from dataset_studio.core.migrations import Migration

SQL = """
CREATE TABLE asset_delete_operations (
    id TEXT PRIMARY KEY,
    status TEXT NOT NULL,
    asset_count INTEGER NOT NULL,
    file_count INTEGER NOT NULL,
    image_count INTEGER NOT NULL,
    annotation_count INTEGER NOT NULL,
    translation_count INTEGER NOT NULL,
    metadata_count INTEGER NOT NULL,
    shared_sidecar_count INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    completed_at TEXT,
    undone_at TEXT,
    error_message TEXT
);

CREATE INDEX idx_asset_delete_operations_status
ON asset_delete_operations(status, created_at);

CREATE TABLE asset_delete_items (
    id TEXT PRIMARY KEY,
    operation_id TEXT NOT NULL,
    position INTEGER NOT NULL,
    asset_id TEXT NOT NULL,
    relative_path TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    FOREIGN KEY(operation_id) REFERENCES asset_delete_operations(id),
    FOREIGN KEY(asset_id) REFERENCES assets(id),
    UNIQUE(operation_id, asset_id),
    UNIQUE(operation_id, position)
);

CREATE INDEX idx_asset_delete_items_operation
ON asset_delete_items(operation_id, position);

CREATE TABLE asset_delete_files (
    id TEXT PRIMARY KEY,
    operation_id TEXT NOT NULL,
    position INTEGER NOT NULL,
    kind TEXT NOT NULL,
    source_relative_path TEXT NOT NULL,
    recovery_relative_path TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    byte_size INTEGER NOT NULL,
    modified_ns INTEGER NOT NULL,
    phase TEXT NOT NULL DEFAULT 'planned',
    FOREIGN KEY(operation_id) REFERENCES asset_delete_operations(id),
    UNIQUE(operation_id, source_relative_path),
    UNIQUE(operation_id, position)
);

CREATE INDEX idx_asset_delete_files_operation_phase
ON asset_delete_files(operation_id, phase, position);
"""

MIGRATION = Migration(version=9, name="asset_deletions", sql=SQL)
