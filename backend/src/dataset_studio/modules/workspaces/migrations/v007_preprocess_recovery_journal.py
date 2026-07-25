from __future__ import annotations

from dataset_studio.core.migrations import Migration

SQL = """
ALTER TABLE preprocess_items
ADD COLUMN phase TEXT NOT NULL DEFAULT 'committed';

CREATE INDEX idx_preprocess_items_operation_phase
ON preprocess_items(operation_id, phase);
"""

MIGRATION = Migration(version=7, name="preprocess_recovery_journal", sql=SQL)
