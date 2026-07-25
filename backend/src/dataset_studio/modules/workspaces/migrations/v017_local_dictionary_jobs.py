from __future__ import annotations

from dataset_studio.core.migrations import Migration

SQL = """
CREATE TABLE jobs_v017 (
    id TEXT PRIMARY KEY,
    status TEXT NOT NULL,
    system_preset_id TEXT NOT NULL,
    system_prompt_snapshot TEXT NOT NULL,
    provider_profile_id TEXT NOT NULL,
    provider_snapshot TEXT NOT NULL,
    user_prompt_snapshot TEXT NOT NULL,
    json_fields_snapshot TEXT NOT NULL,
    scope TEXT NOT NULL,
    overwrite_existing INTEGER NOT NULL DEFAULT 0,
    retry_limit INTEGER NOT NULL DEFAULT 3,
    stop_requested INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    completed_at TEXT,
    kind TEXT NOT NULL DEFAULT 'annotation',
    configuration_snapshot TEXT NOT NULL DEFAULT '{}',
    execution_backend TEXT NOT NULL DEFAULT 'provider'
        CHECK (
            execution_backend IN (
                'provider',
                'local_tagger',
                'local_dictionary'
            )
        ),
    execution_profile_id TEXT,
    execution_snapshot TEXT,
    output_channel TEXT NOT NULL DEFAULT 'description'
        CHECK (output_channel IN ('tags', 'description', 'translation')),
    use_tags_as_context INTEGER NOT NULL DEFAULT 0
);

INSERT INTO jobs_v017 (
    id, status,
    system_preset_id, system_prompt_snapshot,
    provider_profile_id, provider_snapshot,
    user_prompt_snapshot, json_fields_snapshot,
    scope, overwrite_existing, retry_limit, stop_requested,
    created_at, updated_at, completed_at,
    kind, configuration_snapshot,
    execution_backend, execution_profile_id, execution_snapshot,
    output_channel, use_tags_as_context
)
SELECT
    id, status,
    system_preset_id, system_prompt_snapshot,
    provider_profile_id, provider_snapshot,
    user_prompt_snapshot, json_fields_snapshot,
    scope, overwrite_existing, retry_limit, stop_requested,
    created_at, updated_at, completed_at,
    kind, configuration_snapshot,
    execution_backend, execution_profile_id, execution_snapshot,
    output_channel, use_tags_as_context
FROM jobs;

PRAGMA legacy_alter_table = ON;
ALTER TABLE jobs RENAME TO jobs_v016;
ALTER TABLE jobs_v017 RENAME TO jobs;
DROP TABLE jobs_v016;
PRAGMA legacy_alter_table = OFF;

CREATE INDEX idx_jobs_status ON jobs(status, created_at);
CREATE INDEX idx_jobs_execution_profile
ON jobs(execution_backend, execution_profile_id, status);
"""

MIGRATION = Migration(
    version=17,
    name="local_dictionary_jobs",
    sql=SQL,
    foreign_keys_off=True,
)
