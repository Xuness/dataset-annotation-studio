from __future__ import annotations

from dataset_studio.core.migrations import Migration

SQL = """
ALTER TABLE job_attempts ADD COLUMN cache_read_tokens INTEGER;
ALTER TABLE job_attempts ADD COLUMN cache_write_tokens INTEGER;
ALTER TABLE job_attempts ADD COLUMN reasoning_tokens INTEGER;
"""

MIGRATION = Migration(version=4, name="job_attempt_usage_details", sql=SQL)
