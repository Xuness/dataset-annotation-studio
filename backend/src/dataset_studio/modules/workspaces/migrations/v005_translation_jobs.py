from __future__ import annotations

from dataset_studio.core.migrations import Migration

SQL = """
CREATE TABLE annotation_translations (
    asset_id TEXT NOT NULL,
    language TEXT NOT NULL,
    translation_relative_path TEXT NOT NULL,
    source_annotation_hash TEXT NOT NULL,
    translation_modified_ns INTEGER NOT NULL,
    validation_status TEXT NOT NULL,
    provider_profile_id TEXT,
    provider_profile_name TEXT,
    model TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY(asset_id, language),
    FOREIGN KEY(asset_id) REFERENCES assets(id)
);

CREATE UNIQUE INDEX idx_annotation_translations_path
ON annotation_translations(translation_relative_path);

ALTER TABLE jobs ADD COLUMN kind TEXT NOT NULL DEFAULT 'annotation';
ALTER TABLE jobs ADD COLUMN configuration_snapshot TEXT NOT NULL DEFAULT '{}';
ALTER TABLE job_attempts ADD COLUMN source_annotation_hash TEXT;
"""

MIGRATION = Migration(version=5, name="translation_jobs", sql=SQL)
