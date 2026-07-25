from __future__ import annotations

import sqlite3

from dataset_studio.core.time import utc_now_iso
from dataset_studio.modules.annotations.models import AnnotationStatus


def sync_asset_annotation_summary(
    connection: sqlite3.Connection,
    asset_id: str,
) -> None:
    rows = connection.execute(
        """
        SELECT revision.validation_status
        FROM annotation_documents document
        JOIN annotation_document_revisions revision
          ON revision.id = document.head_revision_id
        WHERE document.asset_id = ?
          AND revision.is_tombstone = 0
        """,
        (asset_id,),
    ).fetchall()
    if not rows:
        status = AnnotationStatus.MISSING.value
    else:
        values = {str(row["validation_status"]) for row in rows}
        status = next(
            (
                candidate.value
                for candidate in (
                    AnnotationStatus.ENCODING_ERROR,
                    AnnotationStatus.INVALID,
                    AnnotationStatus.EMPTY,
                    AnnotationStatus.UNCHECKED,
                    AnnotationStatus.MANUALLY_ACCEPTED,
                )
                if candidate.value in values
            ),
            AnnotationStatus.VALID.value,
        )
    connection.execute(
        """
        UPDATE assets
        SET annotation_status = ?, annotation_modified_ns = NULL, updated_at = ?
        WHERE id = ?
        """,
        (status, utc_now_iso(), asset_id),
    )
