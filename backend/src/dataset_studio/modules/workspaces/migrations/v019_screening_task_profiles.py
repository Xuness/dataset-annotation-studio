from __future__ import annotations

from dataset_studio.core.migrations import Migration

SQL = """
ALTER TABLE screening_operations ADD COLUMN task_profile_id TEXT;
ALTER TABLE screening_operations ADD COLUMN task_profile_version TEXT;
ALTER TABLE screening_operations ADD COLUMN task_profile_snapshot TEXT;
ALTER TABLE screening_operations ADD COLUMN task_evaluated_items INTEGER NOT NULL DEFAULT 0
    CHECK (task_evaluated_items >= 0);
ALTER TABLE screening_operations ADD COLUMN task_unavailable_items INTEGER NOT NULL DEFAULT 0
    CHECK (task_unavailable_items >= 0);
ALTER TABLE screening_operations ADD COLUMN task_profile_updated_at TEXT;

ALTER TABLE screening_items ADD COLUMN task_tag_snapshot TEXT;
ALTER TABLE screening_items ADD COLUMN quality_candidate_pool TEXT;
ALTER TABLE screening_items ADD COLUMN task_fit_score REAL;
ALTER TABLE screening_items ADD COLUMN selection_score REAL;
ALTER TABLE screening_items ADD COLUMN selection_rank INTEGER;
ALTER TABLE screening_items ADD COLUMN selection_percentile REAL;
ALTER TABLE screening_items ADD COLUMN task_reason_codes TEXT NOT NULL DEFAULT '[]';
ALTER TABLE screening_items ADD COLUMN task_matched_tags TEXT NOT NULL DEFAULT '[]';

UPDATE screening_items SET quality_candidate_pool = candidate_pool;

CREATE INDEX idx_screening_items_operation_selection
ON screening_items(operation_id, rating, selection_score DESC);
"""

MIGRATION = Migration(version=19, name="screening_task_profiles", sql=SQL)
