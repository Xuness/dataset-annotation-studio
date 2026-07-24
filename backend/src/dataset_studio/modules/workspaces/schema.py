from __future__ import annotations

from pathlib import Path

from dataset_studio.core.migrations import Migration, migrate_database

WORKSPACE_SCHEMA = """
CREATE TABLE IF NOT EXISTS assets (
    id TEXT PRIMARY KEY,
    relative_path TEXT NOT NULL UNIQUE,
    filename TEXT NOT NULL,
    stem TEXT NOT NULL,
    suffix TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    byte_size INTEGER NOT NULL,
    modified_ns INTEGER NOT NULL,
    width INTEGER NOT NULL,
    height INTEGER NOT NULL,
    annotation_relative_path TEXT NOT NULL,
    annotation_status TEXT NOT NULL,
    annotation_modified_ns INTEGER,
    metadata_relative_path TEXT,
    is_present INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_assets_present_path
ON assets(is_present, relative_path);

CREATE INDEX IF NOT EXISTS idx_assets_annotation_status
ON assets(is_present, annotation_status);

CREATE INDEX IF NOT EXISTS idx_assets_content_hash
ON assets(content_hash);

CREATE TABLE IF NOT EXISTS annotation_revisions (
    id TEXT PRIMARY KEY,
    asset_id TEXT NOT NULL,
    content TEXT NOT NULL,
    source TEXT NOT NULL,
    validation_status TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY(asset_id) REFERENCES assets(id)
);

CREATE INDEX IF NOT EXISTS idx_annotation_revisions_asset
ON annotation_revisions(asset_id, created_at DESC);

CREATE TABLE IF NOT EXISTS jobs (
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
    completed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status, created_at);

CREATE TABLE IF NOT EXISTS job_items (
    id TEXT PRIMARY KEY,
    job_id TEXT NOT NULL,
    asset_id TEXT NOT NULL,
    status TEXT NOT NULL,
    attempt_count INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    validation_status TEXT,
    manually_accepted INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY(job_id) REFERENCES jobs(id),
    FOREIGN KEY(asset_id) REFERENCES assets(id),
    UNIQUE(job_id, asset_id)
);

CREATE INDEX IF NOT EXISTS idx_job_items_job_status
ON job_items(job_id, status);

CREATE TABLE IF NOT EXISTS job_attempts (
    id TEXT PRIMARY KEY,
    job_item_id TEXT NOT NULL,
    attempt_number INTEGER NOT NULL,
    status TEXT NOT NULL,
    response_content TEXT,
    error_message TEXT,
    provider_payload_path TEXT,
    started_at TEXT NOT NULL,
    finished_at TEXT,
    input_tokens INTEGER,
    output_tokens INTEGER,
    finish_reason TEXT,
    FOREIGN KEY(job_item_id) REFERENCES job_items(id)
);

CREATE TABLE IF NOT EXISTS preprocess_operations (
    id TEXT PRIMARY KEY,
    status TEXT NOT NULL,
    options_json TEXT NOT NULL,
    item_count INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    completed_at TEXT,
    undone_at TEXT,
    error_message TEXT
);

CREATE TABLE IF NOT EXISTS preprocess_items (
    id TEXT PRIMARY KEY,
    operation_id TEXT NOT NULL,
    asset_id TEXT NOT NULL,
    before_relative_path TEXT NOT NULL,
    after_relative_path TEXT NOT NULL,
    before_hash TEXT NOT NULL,
    after_hash TEXT NOT NULL,
    before_width INTEGER NOT NULL,
    before_height INTEGER NOT NULL,
    after_width INTEGER NOT NULL,
    after_height INTEGER NOT NULL,
    recovery_relative_path TEXT NOT NULL,
    FOREIGN KEY(operation_id) REFERENCES preprocess_operations(id),
    FOREIGN KEY(asset_id) REFERENCES assets(id)
);

CREATE INDEX IF NOT EXISTS idx_preprocess_items_operation
ON preprocess_items(operation_id);
"""

IMAGE_METADATA_VERSION_MIGRATION = """
ALTER TABLE assets
ADD COLUMN image_metadata_version INTEGER NOT NULL DEFAULT 1;
"""

JOB_ITEM_ASSET_UPDATED_INDEX_MIGRATION = """
CREATE INDEX IF NOT EXISTS idx_job_items_asset_updated
ON job_items(asset_id, updated_at DESC);
"""

JOB_ATTEMPT_USAGE_DETAILS_MIGRATION = """
ALTER TABLE job_attempts ADD COLUMN cache_read_tokens INTEGER;
ALTER TABLE job_attempts ADD COLUMN cache_write_tokens INTEGER;
ALTER TABLE job_attempts ADD COLUMN reasoning_tokens INTEGER;
"""

TRANSLATION_JOBS_MIGRATION = """
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

EXPORT_OPERATIONS_MIGRATION = """
CREATE TABLE export_operations (
    id TEXT PRIMARY KEY,
    status TEXT NOT NULL,
    scope TEXT NOT NULL,
    destination_path TEXT NOT NULL,
    total_items INTEGER NOT NULL,
    completed_items INTEGER NOT NULL DEFAULT 0,
    total_bytes INTEGER NOT NULL DEFAULT 0,
    copied_bytes INTEGER NOT NULL DEFAULT 0,
    warning_count INTEGER NOT NULL DEFAULT 0,
    allow_warnings INTEGER NOT NULL DEFAULT 0,
    stop_requested INTEGER NOT NULL DEFAULT 0,
    current_relative_path TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    started_at TEXT,
    completed_at TEXT,
    error_message TEXT
);

CREATE INDEX idx_export_operations_status
ON export_operations(status, created_at);

CREATE TABLE export_items (
    id TEXT PRIMARY KEY,
    operation_id TEXT NOT NULL,
    position INTEGER NOT NULL,
    asset_id TEXT NOT NULL,
    source_relative_path TEXT NOT NULL,
    annotation_relative_path TEXT NOT NULL,
    target_image_name TEXT NOT NULL,
    target_annotation_name TEXT NOT NULL,
    image_hash TEXT NOT NULL,
    image_size INTEGER NOT NULL,
    image_modified_ns INTEGER NOT NULL,
    annotation_exists INTEGER NOT NULL,
    annotation_hash TEXT,
    annotation_size INTEGER NOT NULL DEFAULT 0,
    annotation_modified_ns INTEGER,
    annotation_status TEXT NOT NULL,
    warning_code TEXT,
    warning_message TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    copied_bytes INTEGER NOT NULL DEFAULT 0,
    error_message TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY(operation_id) REFERENCES export_operations(id),
    FOREIGN KEY(asset_id) REFERENCES assets(id),
    UNIQUE(operation_id, asset_id),
    UNIQUE(operation_id, position)
);

CREATE INDEX idx_export_items_operation_status
ON export_items(operation_id, status, position);
"""

PREPROCESS_RECOVERY_JOURNAL_MIGRATION = """
ALTER TABLE preprocess_items
ADD COLUMN phase TEXT NOT NULL DEFAULT 'committed';

CREATE INDEX idx_preprocess_items_operation_phase
ON preprocess_items(operation_id, phase);
"""

JOB_EXECUTION_BACKEND_MIGRATION = """
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

ASSET_DELETIONS_MIGRATION = """
CREATE TABLE asset_delete_operations (
    id TEXT PRIMARY KEY,
    status TEXT NOT NULL,
    asset_count INTEGER NOT NULL,
    file_count INTEGER NOT NULL,
    image_count INTEGER NOT NULL,
    annotation_count INTEGER NOT NULL,
    translation_count INTEGER NOT NULL,
    metadata_count INTEGER NOT NULL,
    shared_sidecar_count INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    completed_at TEXT,
    undone_at TEXT,
    error_message TEXT
);

CREATE INDEX idx_asset_delete_operations_status
ON asset_delete_operations(status, created_at);

CREATE TABLE asset_delete_items (
    id TEXT PRIMARY KEY,
    operation_id TEXT NOT NULL,
    position INTEGER NOT NULL,
    asset_id TEXT NOT NULL,
    relative_path TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    FOREIGN KEY(operation_id) REFERENCES asset_delete_operations(id),
    FOREIGN KEY(asset_id) REFERENCES assets(id),
    UNIQUE(operation_id, asset_id),
    UNIQUE(operation_id, position)
);

CREATE INDEX idx_asset_delete_items_operation
ON asset_delete_items(operation_id, position);

CREATE TABLE asset_delete_files (
    id TEXT PRIMARY KEY,
    operation_id TEXT NOT NULL,
    position INTEGER NOT NULL,
    kind TEXT NOT NULL,
    source_relative_path TEXT NOT NULL,
    recovery_relative_path TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    byte_size INTEGER NOT NULL,
    modified_ns INTEGER NOT NULL,
    phase TEXT NOT NULL DEFAULT 'planned',
    FOREIGN KEY(operation_id) REFERENCES asset_delete_operations(id),
    UNIQUE(operation_id, source_relative_path),
    UNIQUE(operation_id, position)
);

CREATE INDEX idx_asset_delete_files_operation_phase
ON asset_delete_files(operation_id, phase, position);
"""

OUTPUT_RESOURCE_LEASES_MIGRATION = """
CREATE INDEX idx_assets_annotation_relative_path
ON assets(is_present, annotation_relative_path);

CREATE TABLE output_resource_leases (
    resource_key TEXT PRIMARY KEY,
    job_item_id TEXT UNIQUE,
    operation_id TEXT,
    acquired_at TEXT NOT NULL,
    CHECK (
        (job_item_id IS NOT NULL AND operation_id IS NULL)
        OR (job_item_id IS NULL AND operation_id IS NOT NULL)
    ),
    FOREIGN KEY(job_item_id) REFERENCES job_items(id) ON DELETE CASCADE
);

CREATE INDEX idx_output_resource_leases_operation
ON output_resource_leases(operation_id);
"""

DATABASE_ANNOTATION_STORE_MIGRATION = """
CREATE TABLE annotation_store_state (
    singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
    mode TEXT NOT NULL CHECK (mode IN ('pending_import', 'database')),
    backup_relative_path TEXT,
    imported_file_count INTEGER NOT NULL DEFAULT 0,
    imported_at TEXT
);

INSERT INTO annotation_store_state (
    singleton, mode, imported_file_count
) VALUES (1, 'pending_import', 0);

CREATE TABLE annotation_documents (
    id TEXT PRIMARY KEY,
    asset_id TEXT NOT NULL,
    channel TEXT NOT NULL CHECK (
        channel IN ('existing_annotation', 'tags', 'description', 'translation')
    ),
    language TEXT NOT NULL DEFAULT '',
    display_name TEXT NOT NULL,
    content_kind TEXT NOT NULL CHECK (content_kind IN ('text', 'tags')),
    head_revision_id TEXT,
    confirmed_revision_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY(asset_id) REFERENCES assets(id),
    FOREIGN KEY(head_revision_id) REFERENCES annotation_document_revisions(id),
    FOREIGN KEY(confirmed_revision_id) REFERENCES annotation_document_revisions(id),
    UNIQUE(asset_id, channel, language)
);

CREATE INDEX idx_annotation_documents_asset
ON annotation_documents(asset_id, channel, language);

CREATE TABLE annotation_document_revisions (
    id TEXT PRIMARY KEY,
    document_id TEXT NOT NULL,
    parent_revision_id TEXT,
    base_revision_id TEXT,
    source TEXT NOT NULL,
    source_job_item_id TEXT,
    image_content_hash TEXT NOT NULL,
    validation_status TEXT NOT NULL,
    is_tombstone INTEGER NOT NULL DEFAULT 0,
    is_candidate INTEGER NOT NULL DEFAULT 0,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    FOREIGN KEY(document_id) REFERENCES annotation_documents(id),
    FOREIGN KEY(parent_revision_id) REFERENCES annotation_document_revisions(id),
    FOREIGN KEY(base_revision_id) REFERENCES annotation_document_revisions(id),
    FOREIGN KEY(source_job_item_id) REFERENCES job_items(id)
);

CREATE INDEX idx_annotation_document_revisions_document
ON annotation_document_revisions(document_id, created_at DESC);

CREATE INDEX idx_annotation_document_revisions_job_item
ON annotation_document_revisions(source_job_item_id);

CREATE TABLE annotation_text_contents (
    revision_id TEXT PRIMARY KEY,
    content TEXT NOT NULL,
    format TEXT NOT NULL DEFAULT 'plain',
    raw_bytes BLOB,
    FOREIGN KEY(revision_id) REFERENCES annotation_document_revisions(id)
);

CREATE TABLE annotation_tag_items (
    revision_id TEXT NOT NULL,
    position INTEGER NOT NULL,
    name TEXT NOT NULL,
    normalized_name TEXT NOT NULL,
    category TEXT,
    confidence REAL,
    origin TEXT NOT NULL,
    PRIMARY KEY(revision_id, position),
    FOREIGN KEY(revision_id) REFERENCES annotation_document_revisions(id)
);

CREATE INDEX idx_annotation_tag_items_name
ON annotation_tag_items(normalized_name, revision_id);

CREATE TABLE annotation_revision_inputs (
    output_revision_id TEXT NOT NULL,
    input_revision_id TEXT NOT NULL,
    role TEXT NOT NULL,
    PRIMARY KEY(output_revision_id, input_revision_id, role),
    FOREIGN KEY(output_revision_id) REFERENCES annotation_document_revisions(id),
    FOREIGN KEY(input_revision_id) REFERENCES annotation_document_revisions(id)
);

CREATE INDEX idx_annotation_revision_inputs_input
ON annotation_revision_inputs(input_revision_id, role);

CREATE TABLE job_item_annotation_inputs (
    job_item_id TEXT NOT NULL,
    revision_id TEXT NOT NULL,
    role TEXT NOT NULL,
    PRIMARY KEY(job_item_id, role),
    FOREIGN KEY(job_item_id) REFERENCES job_items(id) ON DELETE CASCADE,
    FOREIGN KEY(revision_id) REFERENCES annotation_document_revisions(id)
);

CREATE INDEX idx_job_item_annotation_inputs_revision
ON job_item_annotation_inputs(revision_id, role);

CREATE TABLE legacy_annotation_imports (
    id TEXT PRIMARY KEY,
    asset_id TEXT NOT NULL,
    source_relative_path TEXT NOT NULL,
    source_hash TEXT NOT NULL,
    source_modified_ns INTEGER NOT NULL,
    channel TEXT NOT NULL,
    language TEXT NOT NULL DEFAULT '',
    revision_id TEXT NOT NULL,
    imported_at TEXT NOT NULL,
    FOREIGN KEY(asset_id) REFERENCES assets(id),
    FOREIGN KEY(revision_id) REFERENCES annotation_document_revisions(id),
    UNIQUE(asset_id, source_relative_path, source_hash)
);

ALTER TABLE jobs
ADD COLUMN output_channel TEXT NOT NULL DEFAULT 'description'
    CHECK (output_channel IN ('tags', 'description', 'translation'));

UPDATE jobs
SET output_channel = CASE
    WHEN kind = 'translation' THEN 'translation'
    WHEN execution_backend = 'local_tagger' THEN 'tags'
    ELSE 'description'
END;

ALTER TABLE jobs
ADD COLUMN use_confirmed_tags INTEGER NOT NULL DEFAULT 0;

ALTER TABLE job_items
ADD COLUMN output_base_revision_id TEXT
    REFERENCES annotation_document_revisions(id);

ALTER TABLE export_operations
ADD COLUMN configuration_snapshot TEXT NOT NULL DEFAULT '{}';

ALTER TABLE export_items
ADD COLUMN artifact_snapshot TEXT NOT NULL DEFAULT '[]';
"""

WORKSPACE_SCHEMA_VERSION = 11
WORKSPACE_MIGRATIONS = (
    Migration(1, "initial_workspace_schema", WORKSPACE_SCHEMA),
    Migration(2, "image_metadata_version", IMAGE_METADATA_VERSION_MIGRATION),
    Migration(3, "job_item_asset_updated_index", JOB_ITEM_ASSET_UPDATED_INDEX_MIGRATION),
    Migration(4, "job_attempt_usage_details", JOB_ATTEMPT_USAGE_DETAILS_MIGRATION),
    Migration(5, "translation_jobs", TRANSLATION_JOBS_MIGRATION),
    Migration(6, "export_operations", EXPORT_OPERATIONS_MIGRATION),
    Migration(7, "preprocess_recovery_journal", PREPROCESS_RECOVERY_JOURNAL_MIGRATION),
    Migration(8, "job_execution_backend", JOB_EXECUTION_BACKEND_MIGRATION),
    Migration(9, "asset_deletions", ASSET_DELETIONS_MIGRATION),
    Migration(10, "output_resource_leases", OUTPUT_RESOURCE_LEASES_MIGRATION),
    Migration(11, "database_annotation_store", DATABASE_ANNOTATION_STORE_MIGRATION),
)


def initialize_workspace_database(database_path: Path) -> None:
    migrate_database(database_path, WORKSPACE_MIGRATIONS)
