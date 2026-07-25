from __future__ import annotations

from dataset_studio.core.migrations import Migration

SQL = """
UPDATE assets
SET annotation_status = CASE
        WHEN NOT EXISTS (
            SELECT 1
            FROM annotation_documents document
            JOIN annotation_document_revisions revision
              ON revision.id = document.head_revision_id
            WHERE document.asset_id = assets.id
              AND revision.is_tombstone = 0
        ) THEN 'missing'
        WHEN EXISTS (
            SELECT 1
            FROM annotation_documents document
            JOIN annotation_document_revisions revision
              ON revision.id = document.head_revision_id
            WHERE document.asset_id = assets.id
              AND revision.is_tombstone = 0
              AND revision.validation_status = 'encoding_error'
        ) THEN 'encoding_error'
        WHEN EXISTS (
            SELECT 1
            FROM annotation_documents document
            JOIN annotation_document_revisions revision
              ON revision.id = document.head_revision_id
            WHERE document.asset_id = assets.id
              AND revision.is_tombstone = 0
              AND revision.validation_status = 'invalid'
        ) THEN 'invalid'
        WHEN EXISTS (
            SELECT 1
            FROM annotation_documents document
            JOIN annotation_document_revisions revision
              ON revision.id = document.head_revision_id
            WHERE document.asset_id = assets.id
              AND revision.is_tombstone = 0
              AND revision.validation_status = 'empty'
        ) THEN 'empty'
        WHEN EXISTS (
            SELECT 1
            FROM annotation_documents document
            JOIN annotation_document_revisions revision
              ON revision.id = document.head_revision_id
            WHERE document.asset_id = assets.id
              AND revision.is_tombstone = 0
              AND revision.validation_status = 'unchecked'
        ) THEN 'unchecked'
        WHEN EXISTS (
            SELECT 1
            FROM annotation_documents document
            JOIN annotation_document_revisions revision
              ON revision.id = document.head_revision_id
            WHERE document.asset_id = assets.id
              AND revision.is_tombstone = 0
              AND revision.validation_status = 'manually_accepted'
        ) THEN 'manually_accepted'
        ELSE 'valid'
    END,
    annotation_modified_ns = NULL
WHERE EXISTS (
    SELECT 1
    FROM annotation_documents document
    WHERE document.asset_id = assets.id
);

CREATE TRIGGER annotation_documents_shape_insert
BEFORE INSERT ON annotation_documents
WHEN (
    (NEW.channel = 'translation') != (NEW.language != '')
    OR (NEW.channel = 'tags') != (NEW.content_kind = 'tags')
)
BEGIN
    SELECT RAISE(ABORT, 'annotation document channel shape mismatch');
END;

CREATE TRIGGER annotation_documents_shape_update
BEFORE UPDATE OF channel, language, content_kind ON annotation_documents
WHEN (
    (NEW.channel = 'translation') != (NEW.language != '')
    OR (NEW.channel = 'tags') != (NEW.content_kind = 'tags')
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

CREATE TRIGGER annotation_revisions_scope_insert
BEFORE INSERT ON annotation_document_revisions
WHEN (
    NEW.parent_revision_id IS NOT NULL
    AND NOT EXISTS (
        SELECT 1
        FROM annotation_document_revisions parent
        WHERE parent.id = NEW.parent_revision_id
          AND parent.document_id = NEW.document_id
    )
) OR (
    NEW.base_revision_id IS NOT NULL
    AND NOT EXISTS (
        SELECT 1
        FROM annotation_document_revisions base
        WHERE base.id = NEW.base_revision_id
          AND base.document_id = NEW.document_id
    )
) OR (
    NEW.source_job_item_id IS NOT NULL
    AND NOT EXISTS (
        SELECT 1
        FROM annotation_documents document
        JOIN job_items item ON item.id = NEW.source_job_item_id
        WHERE document.id = NEW.document_id
          AND document.asset_id = item.asset_id
    )
) OR NEW.validation_status NOT IN (
    'missing', 'valid', 'invalid', 'encoding_error',
    'empty', 'unchecked', 'manually_accepted'
)
BEGIN
    SELECT RAISE(ABORT, 'annotation revision scope mismatch');
END;

CREATE TRIGGER annotation_revisions_scope_update
BEFORE UPDATE OF document_id, parent_revision_id, base_revision_id,
                 source_job_item_id, validation_status
ON annotation_document_revisions
WHEN (
    NEW.parent_revision_id IS NOT NULL
    AND NOT EXISTS (
        SELECT 1
        FROM annotation_document_revisions parent
        WHERE parent.id = NEW.parent_revision_id
          AND parent.document_id = NEW.document_id
    )
) OR (
    NEW.base_revision_id IS NOT NULL
    AND NOT EXISTS (
        SELECT 1
        FROM annotation_document_revisions base
        WHERE base.id = NEW.base_revision_id
          AND base.document_id = NEW.document_id
    )
) OR (
    NEW.source_job_item_id IS NOT NULL
    AND NOT EXISTS (
        SELECT 1
        FROM annotation_documents document
        JOIN job_items item ON item.id = NEW.source_job_item_id
        WHERE document.id = NEW.document_id
          AND document.asset_id = item.asset_id
    )
) OR NEW.validation_status NOT IN (
    'missing', 'valid', 'invalid', 'encoding_error',
    'empty', 'unchecked', 'manually_accepted'
)
BEGIN
    SELECT RAISE(ABORT, 'annotation revision scope mismatch');
END;

CREATE TRIGGER annotation_text_content_kind_insert
BEFORE INSERT ON annotation_text_contents
WHEN NOT EXISTS (
    SELECT 1
    FROM annotation_document_revisions revision
    JOIN annotation_documents document ON document.id = revision.document_id
    WHERE revision.id = NEW.revision_id
      AND document.content_kind = 'text'
)
BEGIN
    SELECT RAISE(ABORT, 'annotation text content kind mismatch');
END;

CREATE TRIGGER annotation_text_content_kind_update
BEFORE UPDATE OF revision_id ON annotation_text_contents
WHEN NOT EXISTS (
    SELECT 1
    FROM annotation_document_revisions revision
    JOIN annotation_documents document ON document.id = revision.document_id
    WHERE revision.id = NEW.revision_id
      AND document.content_kind = 'text'
)
BEGIN
    SELECT RAISE(ABORT, 'annotation text content kind mismatch');
END;

CREATE TRIGGER annotation_tag_content_kind_insert
BEFORE INSERT ON annotation_tag_items
WHEN NOT EXISTS (
    SELECT 1
    FROM annotation_document_revisions revision
    JOIN annotation_documents document ON document.id = revision.document_id
    WHERE revision.id = NEW.revision_id
      AND document.content_kind = 'tags'
)
BEGIN
    SELECT RAISE(ABORT, 'annotation tag content kind mismatch');
END;

CREATE TRIGGER annotation_tag_content_kind_update
BEFORE UPDATE OF revision_id ON annotation_tag_items
WHEN NOT EXISTS (
    SELECT 1
    FROM annotation_document_revisions revision
    JOIN annotation_documents document ON document.id = revision.document_id
    WHERE revision.id = NEW.revision_id
      AND document.content_kind = 'tags'
)
BEGIN
    SELECT RAISE(ABORT, 'annotation tag content kind mismatch');
END;

CREATE TRIGGER annotation_revision_inputs_scope_insert
BEFORE INSERT ON annotation_revision_inputs
WHEN NOT EXISTS (
    SELECT 1
    FROM annotation_document_revisions output_revision
    JOIN annotation_documents output_document
      ON output_document.id = output_revision.document_id
    JOIN annotation_document_revisions input_revision
      ON input_revision.id = NEW.input_revision_id
    JOIN annotation_documents input_document
      ON input_document.id = input_revision.document_id
    WHERE output_revision.id = NEW.output_revision_id
      AND output_document.asset_id = input_document.asset_id
)
BEGIN
    SELECT RAISE(ABORT, 'annotation revision input asset mismatch');
END;

CREATE TRIGGER annotation_revision_inputs_scope_update
BEFORE UPDATE OF output_revision_id, input_revision_id ON annotation_revision_inputs
WHEN NOT EXISTS (
    SELECT 1
    FROM annotation_document_revisions output_revision
    JOIN annotation_documents output_document
      ON output_document.id = output_revision.document_id
    JOIN annotation_document_revisions input_revision
      ON input_revision.id = NEW.input_revision_id
    JOIN annotation_documents input_document
      ON input_document.id = input_revision.document_id
    WHERE output_revision.id = NEW.output_revision_id
      AND output_document.asset_id = input_document.asset_id
)
BEGIN
    SELECT RAISE(ABORT, 'annotation revision input asset mismatch');
END;

CREATE TRIGGER job_item_annotation_inputs_scope_insert
BEFORE INSERT ON job_item_annotation_inputs
WHEN NOT EXISTS (
    SELECT 1
    FROM job_items item
    JOIN annotation_document_revisions revision
      ON revision.id = NEW.revision_id
    JOIN annotation_documents document
      ON document.id = revision.document_id
    WHERE item.id = NEW.job_item_id
      AND item.asset_id = document.asset_id
)
BEGIN
    SELECT RAISE(ABORT, 'job annotation input asset mismatch');
END;

CREATE TRIGGER job_item_annotation_inputs_scope_update
BEFORE UPDATE OF job_item_id, revision_id ON job_item_annotation_inputs
WHEN NOT EXISTS (
    SELECT 1
    FROM job_items item
    JOIN annotation_document_revisions revision
      ON revision.id = NEW.revision_id
    JOIN annotation_documents document
      ON document.id = revision.document_id
    WHERE item.id = NEW.job_item_id
      AND item.asset_id = document.asset_id
)
BEGIN
    SELECT RAISE(ABORT, 'job annotation input asset mismatch');
END;

CREATE TRIGGER job_items_output_base_scope_insert
BEFORE INSERT ON job_items
WHEN NEW.output_base_revision_id IS NOT NULL
  AND NOT EXISTS (
      SELECT 1
      FROM annotation_document_revisions revision
      JOIN annotation_documents document
        ON document.id = revision.document_id
      WHERE revision.id = NEW.output_base_revision_id
        AND document.asset_id = NEW.asset_id
  )
BEGIN
    SELECT RAISE(ABORT, 'job output base asset mismatch');
END;

CREATE TRIGGER job_items_output_base_scope_update
BEFORE UPDATE OF asset_id, output_base_revision_id ON job_items
WHEN NEW.output_base_revision_id IS NOT NULL
  AND NOT EXISTS (
      SELECT 1
      FROM annotation_document_revisions revision
      JOIN annotation_documents document
        ON document.id = revision.document_id
      WHERE revision.id = NEW.output_base_revision_id
        AND document.asset_id = NEW.asset_id
  )
BEGIN
    SELECT RAISE(ABORT, 'job output base asset mismatch');
END;

UPDATE annotation_documents
SET id = id,
    channel = channel,
    language = language,
    content_kind = content_kind,
    head_revision_id = head_revision_id,
    reviewed_revision_id = reviewed_revision_id;

UPDATE annotation_document_revisions
SET document_id = document_id,
    parent_revision_id = parent_revision_id,
    base_revision_id = base_revision_id,
    source_job_item_id = source_job_item_id,
    validation_status = validation_status;

UPDATE annotation_text_contents SET revision_id = revision_id;
UPDATE annotation_tag_items SET revision_id = revision_id;
UPDATE annotation_revision_inputs
SET output_revision_id = output_revision_id,
    input_revision_id = input_revision_id;
UPDATE job_item_annotation_inputs
SET job_item_id = job_item_id,
    revision_id = revision_id;
UPDATE job_items
SET asset_id = asset_id,
    output_base_revision_id = output_base_revision_id;
"""

MIGRATION = Migration(version=14, name="annotation_relation_invariants", sql=SQL)
