from __future__ import annotations

from dataset_studio.core.migrations import Migration

SQL = """
CREATE TABLE export_operations (
    id TEXT PRIMARY KEY,
    status TEXT NOT NULL,
    scope TEXT NOT NULL,
    destination_path TEXT NOT NULL,
    total_items INTEGER NOT NULL,
    completed_items INTEGER NOT NULL DEFAULT 0,
    total_bytes INTEGER NOT NULL DEFAULT 0,
    copied_bytes INTEGER NOT NULL DEFAULT 0,
    warning_count INTEGER NOT NULL DEFAULT 0,
    allow_warnings INTEGER NOT NULL DEFAULT 0,
    stop_requested INTEGER NOT NULL DEFAULT 0,
    current_relative_path TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    started_at TEXT,
    completed_at TEXT,
    error_message TEXT
);

CREATE INDEX idx_export_operations_status
ON export_operations(status, created_at);

CREATE TABLE export_items (
    id TEXT PRIMARY KEY,
    operation_id TEXT NOT NULL,
    position INTEGER NOT NULL,
    asset_id TEXT NOT NULL,
    source_relative_path TEXT NOT NULL,
    annotation_relative_path TEXT NOT NULL,
    target_image_name TEXT NOT NULL,
    target_annotation_name TEXT NOT NULL,
    image_hash TEXT NOT NULL,
    image_size INTEGER NOT NULL,
    image_modified_ns INTEGER NOT NULL,
    annotation_exists INTEGER NOT NULL,
    annotation_hash TEXT,
    annotation_size INTEGER NOT NULL DEFAULT 0,
    annotation_modified_ns INTEGER,
    annotation_status TEXT NOT NULL,
    warning_code TEXT,
    warning_message TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    copied_bytes INTEGER NOT NULL DEFAULT 0,
    error_message TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY(operation_id) REFERENCES export_operations(id),
    FOREIGN KEY(asset_id) REFERENCES assets(id),
    UNIQUE(operation_id, asset_id),
    UNIQUE(operation_id, position)
);

CREATE INDEX idx_export_items_operation_status
ON export_items(operation_id, status, position);
"""

MIGRATION = Migration(version=6, name="export_operations", sql=SQL)
