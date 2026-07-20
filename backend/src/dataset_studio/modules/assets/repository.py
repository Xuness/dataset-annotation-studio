from __future__ import annotations

import sqlite3
from pathlib import Path

from dataset_studio.core.sqlite import connect, transaction
from dataset_studio.modules.assets.models import AssetRecord, AssetSummary

LATEST_JOB_STATUS_SQL = """
(
    SELECT job_items.status
    FROM job_items
    WHERE job_items.asset_id = assets.id
      AND EXISTS (
          SELECT 1 FROM jobs
          WHERE jobs.id = job_items.job_id AND jobs.kind = 'annotation'
      )
    ORDER BY job_items.updated_at DESC, job_items.created_at DESC, job_items.id DESC
    LIMIT 1
)
"""

LATEST_JOB_ERROR_SQL = """
(
    SELECT job_items.last_error
    FROM job_items
    WHERE job_items.asset_id = assets.id
      AND EXISTS (
          SELECT 1 FROM jobs
          WHERE jobs.id = job_items.job_id AND jobs.kind = 'annotation'
      )
    ORDER BY job_items.updated_at DESC, job_items.created_at DESC, job_items.id DESC
    LIMIT 1
)
"""

UNRESOLVED_GENERATION_FAILURE_SQL = f"""
(
    assets.annotation_status = 'missing'
    AND {LATEST_JOB_STATUS_SQL} = 'failed'
)
"""

REVIEW_ANNOTATION_STATUSES = ("invalid", "empty", "unchecked")


class AssetRepository:
    def __init__(self, database_path: Path) -> None:
        self._database_path = database_path

    def load_all_records(self) -> dict[str, sqlite3.Row]:
        connection = connect(self._database_path)
        try:
            rows = connection.execute("SELECT * FROM assets").fetchall()
            return {str(row["relative_path"]): row for row in rows}
        finally:
            connection.close()

    def replace_scan(self, records: list[AssetRecord], present_ids: set[str]) -> tuple[int, int]:
        with transaction(self._database_path) as connection:
            before = {
                str(row["id"]): (str(row["relative_path"]), int(row["is_present"]))
                for row in connection.execute("SELECT id, relative_path, is_present FROM assets")
            }
            connection.execute("UPDATE assets SET is_present = 0")
            for record in records:
                connection.execute(
                    """
                    INSERT INTO assets (
                        id, relative_path, filename, stem, suffix, content_hash,
                        byte_size, modified_ns, width, height,
                        annotation_relative_path, annotation_status,
                        annotation_modified_ns, metadata_relative_path,
                        image_metadata_version, is_present, created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
                    ON CONFLICT(id) DO UPDATE SET
                        relative_path = excluded.relative_path,
                        filename = excluded.filename,
                        stem = excluded.stem,
                        suffix = excluded.suffix,
                        content_hash = excluded.content_hash,
                        byte_size = excluded.byte_size,
                        modified_ns = excluded.modified_ns,
                        width = excluded.width,
                        height = excluded.height,
                        annotation_relative_path = excluded.annotation_relative_path,
                        annotation_status = excluded.annotation_status,
                        annotation_modified_ns = excluded.annotation_modified_ns,
                        metadata_relative_path = excluded.metadata_relative_path,
                        image_metadata_version = excluded.image_metadata_version,
                        is_present = 1,
                        updated_at = excluded.updated_at
                    """,
                    (
                        record.id,
                        record.relative_path,
                        record.filename,
                        record.stem,
                        record.suffix,
                        record.content_hash,
                        record.byte_size,
                        record.modified_ns,
                        record.width,
                        record.height,
                        record.annotation_relative_path,
                        record.annotation_status,
                        record.annotation_modified_ns,
                        record.metadata_relative_path,
                        record.image_metadata_version,
                        record.created_at,
                        record.updated_at,
                    ),
                )

            added = sum(1 for record in records if record.id not in before)
            missing = sum(
                1
                for asset_id, (_, was_present) in before.items()
                if was_present and asset_id not in present_ids
            )
            return added, missing

    def list_assets(
        self,
        *,
        search: str = "",
        annotation_status: str | None = None,
        offset: int = 0,
        limit: int = 200,
    ) -> tuple[list[AssetSummary], int, dict[str, int]]:
        where, parameters = self._asset_filter(search, annotation_status)
        connection = connect(self._database_path)
        try:
            total = int(
                connection.execute(
                    f"SELECT COUNT(*) FROM assets WHERE {where}", parameters
                ).fetchone()[0]
            )
            rows = connection.execute(
                f"""
                SELECT id, relative_path, filename, suffix,
                       content_hash AS content_version, byte_size, width, height,
                       annotation_relative_path, annotation_status, metadata_relative_path,
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
                WHERE {where}
                ORDER BY relative_path COLLATE NOCASE
                LIMIT ? OFFSET ?
                """,
                [*parameters, limit, offset],
            ).fetchall()
            count_rows = connection.execute(
                """
                SELECT annotation_status, COUNT(*) AS count
                FROM assets
                WHERE is_present = 1
                GROUP BY annotation_status
                """
            ).fetchall()
            status_counts = {str(row["annotation_status"]): int(row["count"]) for row in count_rows}
            failed_count = int(
                connection.execute(
                    f"""
                    SELECT COUNT(*)
                    FROM assets
                    WHERE is_present = 1 AND {UNRESOLVED_GENERATION_FAILURE_SQL}
                    """
                ).fetchone()[0]
            )
            status_counts["failed"] = failed_count
            status_counts["needs_review"] = failed_count + sum(
                status_counts.get(status, 0) for status in REVIEW_ANNOTATION_STATUSES
            )
            return ([AssetSummary.model_validate(dict(row)) for row in rows], total, status_counts)
        finally:
            connection.close()

    def list_asset_ids(
        self,
        *,
        search: str = "",
        annotation_status: str | None = None,
    ) -> list[str]:
        where, parameters = self._asset_filter(search, annotation_status)
        connection = connect(self._database_path)
        try:
            rows = connection.execute(
                f"""
                SELECT id
                FROM assets
                WHERE {where}
                ORDER BY relative_path COLLATE NOCASE
                """,
                parameters,
            ).fetchall()
            return [str(row["id"]) for row in rows]
        finally:
            connection.close()

    @staticmethod
    def _asset_filter(search: str, annotation_status: str | None) -> tuple[str, list[object]]:
        clauses = ["is_present = 1"]
        parameters: list[object] = []
        if search:
            clauses.append("relative_path LIKE ? ESCAPE '\\'")
            escaped = search.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
            parameters.append(f"%{escaped}%")
        if annotation_status == "failed":
            clauses.append(UNRESOLVED_GENERATION_FAILURE_SQL)
        elif annotation_status == "needs_review":
            review_statuses = ", ".join(f"'{status}'" for status in REVIEW_ANNOTATION_STATUSES)
            clauses.append(
                f"(annotation_status IN ({review_statuses}) OR {UNRESOLVED_GENERATION_FAILURE_SQL})"
            )
        elif annotation_status:
            clauses.append("annotation_status = ?")
            parameters.append(annotation_status)
        return " AND ".join(clauses), parameters

    def get_asset(self, asset_id: str) -> sqlite3.Row | None:
        connection = connect(self._database_path)
        try:
            return connection.execute(
                "SELECT * FROM assets WHERE id = ? AND is_present = 1", (asset_id,)
            ).fetchone()
        finally:
            connection.close()

    def count_summary(self) -> tuple[int, int, int]:
        connection = connect(self._database_path)
        try:
            row = connection.execute(
                f"""
                SELECT
                    COUNT(*) AS total,
                    SUM(CASE WHEN annotation_status != 'missing' THEN 1 ELSE 0 END) AS annotated,
                    SUM(
                        CASE
                            WHEN annotation_status IN ('invalid', 'empty')
                                 OR {UNRESOLVED_GENERATION_FAILURE_SQL}
                            THEN 1 ELSE 0
                        END
                    ) AS invalid
                FROM assets
                WHERE is_present = 1
                """
            ).fetchone()
            return int(row["total"] or 0), int(row["annotated"] or 0), int(row["invalid"] or 0)
        finally:
            connection.close()
