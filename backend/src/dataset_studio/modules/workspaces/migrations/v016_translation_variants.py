from __future__ import annotations

from dataset_studio.core.migrations import Migration

SQL = """
DROP TRIGGER IF EXISTS annotation_documents_shape_insert;
DROP TRIGGER IF EXISTS annotation_documents_shape_update;
DROP TRIGGER IF EXISTS annotation_documents_revision_scope_insert;
DROP TRIGGER IF EXISTS annotation_documents_revision_scope_update;

CREATE TABLE annotation_documents_v016 (
    id TEXT PRIMARY KEY,
    asset_id TEXT NOT NULL,
    channel TEXT NOT NULL CHECK (
        channel IN ('existing_annotation', 'tags', 'description', 'translation')
    ),
    language TEXT NOT NULL DEFAULT '',
    translation_source_kind TEXT NOT NULL DEFAULT '',
    translation_producer_kind TEXT NOT NULL DEFAULT '',
    display_name TEXT NOT NULL,
    content_kind TEXT NOT NULL CHECK (content_kind IN ('text', 'tags')),
    head_revision_id TEXT,
    reviewed_revision_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY(asset_id) REFERENCES assets(id),
    FOREIGN KEY(head_revision_id) REFERENCES annotation_document_revisions(id),
    FOREIGN KEY(reviewed_revision_id) REFERENCES annotation_document_revisions(id),
    UNIQUE(
        asset_id,
        channel,
        language,
        translation_source_kind,
        translation_producer_kind
    )
);

INSERT INTO annotation_documents_v016 (
    id, asset_id, channel, language,
    translation_source_kind, translation_producer_kind,
    display_name, content_kind,
    head_revision_id, reviewed_revision_id,
    created_at, updated_at
)
SELECT
    id, asset_id, channel, language,
    CASE WHEN channel = 'translation' THEN 'description' ELSE '' END,
    CASE WHEN channel = 'translation' THEN 'llm' ELSE '' END,
    display_name, content_kind,
    head_revision_id, reviewed_revision_id,
    created_at, updated_at
FROM annotation_documents;

PRAGMA legacy_alter_table = ON;
ALTER TABLE annotation_documents RENAME TO annotation_documents_v015;
ALTER TABLE annotation_documents_v016 RENAME TO annotation_documents;
DROP TABLE annotation_documents_v015;
PRAGMA legacy_alter_table = OFF;

CREATE INDEX idx_annotation_documents_asset
ON annotation_documents(
    asset_id,
    channel,
    language,
    translation_source_kind,
    translation_producer_kind
);

CREATE TRIGGER annotation_documents_shape_insert
BEFORE INSERT ON annotation_documents
WHEN (
    (NEW.channel = 'translation') != (NEW.language != '')
    OR (NEW.channel = 'tags') != (NEW.content_kind = 'tags')
    OR (
        NEW.channel = 'translation'
        AND NEW.translation_source_kind NOT IN ('description', 'tags')
    )
    OR (
        NEW.channel = 'translation'
        AND NEW.translation_producer_kind NOT IN ('llm', 'local_dictionary')
    )
    OR (
        NEW.channel != 'translation'
        AND (
            NEW.translation_source_kind != ''
            OR NEW.translation_producer_kind != ''
        )
    )
)
BEGIN
    SELECT RAISE(ABORT, 'annotation document channel shape mismatch');
END;

CREATE TRIGGER annotation_documents_shape_update
BEFORE UPDATE OF
    channel, language, content_kind,
    translation_source_kind, translation_producer_kind
ON annotation_documents
WHEN (
    (NEW.channel = 'translation') != (NEW.language != '')
    OR (NEW.channel = 'tags') != (NEW.content_kind = 'tags')
    OR (
        NEW.channel = 'translation'
        AND NEW.translation_source_kind NOT IN ('description', 'tags')
    )
    OR (
        NEW.channel = 'translation'
        AND NEW.translation_producer_kind NOT IN ('llm', 'local_dictionary')
    )
    OR (
        NEW.channel != 'translation'
        AND (
            NEW.translation_source_kind != ''
            OR NEW.translation_producer_kind != ''
        )
    )
)
BEGIN
    SELECT RAISE(ABORT, 'annotation document channel shape mismatch');
END;

CREATE TRIGGER annotation_documents_revision_scope_insert
BEFORE INSERT ON annotation_documents
WHEN (
    NEW.head_revision_id IS NOT NULL
    AND NOT EXISTS (
        SELECT 1
        FROM annotation_document_revisions revision
        WHERE revision.id = NEW.head_revision_id
          AND revision.document_id = NEW.id
    )
) OR (
    NEW.reviewed_revision_id IS NOT NULL
    AND NOT EXISTS (
        SELECT 1
        FROM annotation_document_revisions revision
        WHERE revision.id = NEW.reviewed_revision_id
          AND revision.document_id = NEW.id
    )
)
BEGIN
    SELECT RAISE(ABORT, 'annotation document revision scope mismatch');
END;

CREATE TRIGGER annotation_documents_revision_scope_update
BEFORE UPDATE OF id, head_revision_id, reviewed_revision_id ON annotation_documents
WHEN (
    NEW.head_revision_id IS NOT NULL
    AND NOT EXISTS (
        SELECT 1
        FROM annotation_document_revisions revision
        WHERE revision.id = NEW.head_revision_id
          AND revision.document_id = NEW.id
    )
) OR (
    NEW.reviewed_revision_id IS NOT NULL
    AND NOT EXISTS (
        SELECT 1
        FROM annotation_document_revisions revision
        WHERE revision.id = NEW.reviewed_revision_id
          AND revision.document_id = NEW.id
    )
)
BEGIN
    SELECT RAISE(ABORT, 'annotation document revision scope mismatch');
END;
"""

MIGRATION = Migration(
    version=16,
    name="translation_variants",
    sql=SQL,
    foreign_keys_off=True,
)
