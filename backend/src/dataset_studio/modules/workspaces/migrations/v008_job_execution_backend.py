from __future__ import annotations

from dataset_studio.core.migrations import Migration

SQL = """
ALTER TABLE jobs
ADD COLUMN execution_backend TEXT NOT NULL DEFAULT 'provider'
    CHECK (execution_backend IN ('provider', 'local_tagger'));

ALTER TABLE jobs
ADD COLUMN execution_profile_id TEXT;

ALTER TABLE jobs
ADD COLUMN execution_snapshot TEXT;

UPDATE jobs
SET execution_profile_id = provider_profile_id,
    execution_snapshot = provider_snapshot;

CREATE INDEX idx_jobs_execution_profile
ON jobs(execution_backend, execution_profile_id, status);
"""

MIGRATION = Migration(version=8, name="job_execution_backend", sql=SQL)
