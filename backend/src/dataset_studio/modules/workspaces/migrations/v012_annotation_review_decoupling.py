from __future__ import annotations

from dataset_studio.core.migrations import Migration

SQL = """
ALTER TABLE annotation_documents
RENAME COLUMN confirmed_revision_id TO reviewed_revision_id;

ALTER TABLE jobs
RENAME COLUMN use_confirmed_tags TO use_tags_as_context;

UPDATE annotation_documents
SET reviewed_revision_id = NULL
WHERE reviewed_revision_id IS NOT NULL
  AND (
      (
          channel = 'tags'
          AND reviewed_revision_id IN (
              SELECT id
              FROM annotation_document_revisions
              WHERE source IN ('local_tagger', 'manual_edit')
          )
      )
      OR reviewed_revision_id IN (
          SELECT id
          FROM annotation_document_revisions
          WHERE source = 'legacy_txt_import'
      )
  );
"""

MIGRATION = Migration(version=12, name="annotation_review_decoupling", sql=SQL)
