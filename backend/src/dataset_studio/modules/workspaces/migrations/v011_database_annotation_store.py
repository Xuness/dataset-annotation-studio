from __future__ import annotations

from dataset_studio.core.migrations import Migration

SQL = """
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

MIGRATION = Migration(version=11, name="database_annotation_store", sql=SQL)
