from __future__ import annotations

from dataset_studio.core.migrations import Migration

SQL = """
CREATE INDEX IF NOT EXISTS idx_job_items_asset_updated
ON job_items(asset_id, updated_at DESC);
"""

MIGRATION = Migration(version=3, name="job_item_asset_updated_index", sql=SQL)
