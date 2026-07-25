from __future__ import annotations

from dataset_studio.core.migrations import Migration

SQL = """
ALTER TABLE preprocess_operations
ADD COLUMN execution_json TEXT NOT NULL
    DEFAULT '{"mode":"cpu_only","accelerator_id":null,"max_workers":null,"batch_size":null}';

ALTER TABLE preprocess_operations
ADD COLUMN runtime_json TEXT;

ALTER TABLE preprocess_items
ADD COLUMN planned_route TEXT;

ALTER TABLE preprocess_items
ADD COLUMN actual_route TEXT;

ALTER TABLE preprocess_items
ADD COLUMN backend_id TEXT;

ALTER TABLE preprocess_items
ADD COLUMN decode_location TEXT;

ALTER TABLE preprocess_items
ADD COLUMN resize_location TEXT;

ALTER TABLE preprocess_items
ADD COLUMN encode_location TEXT;

ALTER TABLE preprocess_items
ADD COLUMN route_reason_code TEXT;

ALTER TABLE preprocess_items
ADD COLUMN fallback_code TEXT;

ALTER TABLE preprocess_items
ADD COLUMN render_duration_ms INTEGER;
"""

MIGRATION = Migration(version=15, name="preprocess_execution_runtime", sql=SQL)
