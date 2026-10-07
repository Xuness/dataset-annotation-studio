from __future__ import annotations

from dataset_studio.modules.annotations.projection import (
    INVALID_VALIDATION_VALUES,
    translation_dependency_stale_sql,
)


def _latest_unresolved_generation_failure_sql(column: str) -> str:
    if column not in {"id", "last_error"}:
        raise ValueError("不支持的任务失败字段。")
    return f"""
    (
        SELECT failed.{column}
        FROM job_items failed
        JOIN jobs failed_job ON failed_job.id = failed.job_id
        WHERE failed.asset_id = assets.id
          AND failed.status = 'failed'
          AND NOT EXISTS (
              SELECT 1
              FROM job_items newer
              JOIN jobs newer_job ON newer_job.id = newer.job_id
              WHERE newer.asset_id = failed.asset_id
                AND newer_job.output_channel = failed_job.output_channel
                AND (
                    failed_job.output_channel != 'translation'
                    OR (
                        LOWER(
                            CASE
                                WHEN json_valid(newer_job.configuration_snapshot)
                                THEN COALESCE(
                                    json_extract(
                                        newer_job.configuration_snapshot,
                                        '$.target_language'
                                    ),
                                    ''
                                )
                                ELSE ''
                            END
                        )
                        =
                        LOWER(
                            CASE
                                WHEN json_valid(failed_job.configuration_snapshot)
                                THEN COALESCE(
                                    json_extract(
                                        failed_job.configuration_snapshot,
                                        '$.target_language'
                                    ),
                                    ''
                                )
                                ELSE ''
                            END
                        )
                        AND COALESCE(
                            CASE
                                WHEN json_valid(newer_job.configuration_snapshot)
                                THEN json_extract(
                                    newer_job.configuration_snapshot,
                                    '$.translation_source_kind'
                                )
                            END,
                            'description'
                        )
                        =
                        COALESCE(
                            CASE
                                WHEN json_valid(failed_job.configuration_snapshot)
                                THEN json_extract(
                                    failed_job.configuration_snapshot,
                                    '$.translation_source_kind'
                                )
                            END,
                            'description'
                        )
                        AND COALESCE(
                            CASE
                                WHEN json_valid(newer_job.configuration_snapshot)
                                THEN json_extract(
                                    newer_job.configuration_snapshot,
                                    '$.translation_producer_kind'
                                )
                            END,
                            'llm'
                        )
                        =
                        COALESCE(
                            CASE
                                WHEN json_valid(failed_job.configuration_snapshot)
                                THEN json_extract(
                                    failed_job.configuration_snapshot,
                                    '$.translation_producer_kind'
                                )
                            END,
                            'llm'
                        )
                    )
                )
                AND (
                    newer.updated_at > failed.updated_at
                    OR (
                        newer.updated_at = failed.updated_at
                        AND newer.rowid > failed.rowid
                    )
                )
          )
        ORDER BY failed.updated_at DESC, failed.rowid DESC
        LIMIT 1
    )
    """


LATEST_JOB_ERROR_SQL = _latest_unresolved_generation_failure_sql("last_error")
UNRESOLVED_GENERATION_FAILURE_SQL = (
    f"({_latest_unresolved_generation_failure_sql('id')} IS NOT NULL)"
)

REVIEW_VALIDATION_STATUSES = INVALID_VALIDATION_VALUES
REVIEW_VALIDATION_SQL = ", ".join(f"'{status}'" for status in REVIEW_VALIDATION_STATUSES)

TRANSLATION_DEPENDENCY_STALE_SQL = translation_dependency_stale_sql(
    document_alias="d",
    revision_alias="r",
    asset_alias="assets",
)

ACTIVE_UNREVIEWED_DOCUMENT_SQL = f"""
EXISTS (
    SELECT 1
    FROM annotation_documents d
    JOIN annotation_document_revisions r ON r.id = d.head_revision_id
    WHERE d.asset_id = assets.id
      AND r.is_tombstone = 0
      AND r.image_content_hash = assets.content_hash
      AND NOT ({TRANSLATION_DEPENDENCY_STALE_SQL})
      AND r.validation_status NOT IN ({REVIEW_VALIDATION_SQL})
      AND (
          d.reviewed_revision_id IS NULL
          OR d.reviewed_revision_id != d.head_revision_id
      )
)
"""

STALE_DOCUMENT_SQL = f"""
EXISTS (
    SELECT 1
    FROM annotation_documents d
    JOIN annotation_document_revisions r ON r.id = d.head_revision_id
    WHERE d.asset_id = assets.id
      AND r.is_tombstone = 0
      AND (
          r.image_content_hash != assets.content_hash
          OR {TRANSLATION_DEPENDENCY_STALE_SQL}
      )
)
"""

INVALID_DOCUMENT_SQL = """
EXISTS (
    SELECT 1
    FROM annotation_documents d
    JOIN annotation_document_revisions r ON r.id = d.head_revision_id
    WHERE d.asset_id = assets.id
      AND r.is_tombstone = 0
      AND r.validation_status IN ('invalid', 'encoding_error', 'empty', 'unchecked')
)
"""

NEEDS_REVIEW_SQL = f"""
(
    {ACTIVE_UNREVIEWED_DOCUMENT_SQL}
    OR {STALE_DOCUMENT_SQL}
    OR {INVALID_DOCUMENT_SQL}
    OR {UNRESOLVED_GENERATION_FAILURE_SQL}
)
"""


ASSET_SUMMARY_SELECT = f"""
                SELECT id, relative_path, filename, suffix,
                       content_hash AS content_version, byte_size, width, height,
                       annotation_relative_path, annotation_status, metadata_relative_path,
                       EXISTS (
                           SELECT 1 FROM asset_candidates c WHERE c.asset_id = assets.id
                       ) AS is_candidate,
                       CASE
                           WHEN {UNRESOLVED_GENERATION_FAILURE_SQL} THEN 'failed'
                           ELSE NULL
                       END AS generation_status,
                       CASE
                           WHEN {UNRESOLVED_GENERATION_FAILURE_SQL}
                           THEN {LATEST_JOB_ERROR_SQL}
                           ELSE NULL
                       END AS generation_error
                FROM assets
"""
