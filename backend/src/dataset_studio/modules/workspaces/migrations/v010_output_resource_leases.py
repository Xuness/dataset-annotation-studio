from __future__ import annotations

from dataset_studio.core.migrations import Migration

SQL = """
CREATE INDEX idx_assets_annotation_relative_path
ON assets(is_present, annotation_relative_path);

CREATE TABLE output_resource_leases (
    resource_key TEXT PRIMARY KEY,
    job_item_id TEXT UNIQUE,
    operation_id TEXT,
    acquired_at TEXT NOT NULL,
    CHECK (
        (job_item_id IS NOT NULL AND operation_id IS NULL)
        OR (job_item_id IS NULL AND operation_id IS NOT NULL)
    ),
    FOREIGN KEY(job_item_id) REFERENCES job_items(id) ON DELETE CASCADE
);

CREATE INDEX idx_output_resource_leases_operation
ON output_resource_leases(operation_id);
"""

MIGRATION = Migration(version=10, name="output_resource_leases", sql=SQL)
