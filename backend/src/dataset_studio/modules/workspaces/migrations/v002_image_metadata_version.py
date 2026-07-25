from __future__ import annotations

from dataset_studio.core.migrations import Migration

SQL = """
ALTER TABLE assets
ADD COLUMN image_metadata_version INTEGER NOT NULL DEFAULT 1;
"""

MIGRATION = Migration(version=2, name="image_metadata_version", sql=SQL)
