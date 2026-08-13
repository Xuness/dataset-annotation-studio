from __future__ import annotations

from dataset_studio.core.migrations import Migration

SQL = """
CREATE TABLE asset_candidates (
    asset_id TEXT PRIMARY KEY,
    added_at TEXT NOT NULL,
    source_kind TEXT NOT NULL CHECK (source_kind IN ('manual', 'screening')),
    source_operation_id TEXT,
    FOREIGN KEY(asset_id) REFERENCES assets(id) ON DELETE CASCADE
);
"""

MIGRATION = Migration(version=20, name="asset_candidates", sql=SQL)
