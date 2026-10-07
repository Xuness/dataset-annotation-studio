from __future__ import annotations

import sqlite3
from collections.abc import Sequence
from pathlib import Path

from dataset_studio.core.sqlite import connect, transaction
from dataset_studio.modules.annotations.projection import (
    document_state_projection_sql,
    resolve_document_row_state,
)
from dataset_studio.modules.assets.candidates import candidate_scope_clause
from dataset_studio.modules.assets.models import (
    AssetLookupRequest,
    AssetRecord,
    AssetSummary,
    CandidateScope,
)
from dataset_studio.modules.assets.projections import (
    ACTIVE_UNREVIEWED_DOCUMENT_SQL,
    ASSET_SUMMARY_SELECT,
    NEEDS_REVIEW_SQL,
    REVIEW_VALIDATION_STATUSES,
    STALE_DOCUMENT_SQL,
    UNRESOLVED_GENERATION_FAILURE_SQL,
)


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

    def replace_scan(
        self,
        records: list[AssetRecord],
        present_ids: set[str],
        annotation_baseline: dict[str, tuple[str, int | None]] | None = None,
    ) -> tuple[int, int]:
        annotation_baseline = annotation_baseline or {}
        with transaction(self._database_path) as connection:
            before_rows = connection.execute(
                """
                SELECT id, relative_path, is_present, annotation_status, annotation_modified_ns
                FROM assets
                """
            ).fetchall()
            before = {
                str(row["id"]): (str(row["relative_path"]), int(row["is_present"]))
                for row in before_rows
            }
            current_annotation_state = {
                str(row["id"]): (
                    str(row["annotation_status"]),
                    int(row["annotation_modified_ns"])
                    if row["annotation_modified_ns"] is not None
                    else None,
                )
                for row in before_rows
            }
            connection.execute("UPDATE assets SET is_present = 0")
            for record in records:
                scanned_status = record.annotation_status
                scanned_modified_ns = record.annotation_modified_ns
                current_state = current_annotation_state.get(record.id)
                baseline_state = annotation_baseline.get(record.id)
                if current_state is not None and current_state != baseline_state:
                    scanned_status, scanned_modified_ns = current_state
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
                        scanned_status,
                        scanned_modified_ns,
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
        folder_path: str = "",
        folder_paths: Sequence[str] = (),
        candidate_scope: CandidateScope = CandidateScope.AUTO,
        offset: int = 0,
        limit: int = 200,
    ) -> tuple[list[AssetSummary], int, dict[str, int]]:
        selected_folders = tuple(dict.fromkeys((*folder_paths, folder_path)))
        where, parameters = self._asset_filter(
            search,
            annotation_status,
            selected_folders,
            candidate_scope,
        )
        scope_where, scope_parameters = self._asset_filter(
            search,
            None,
            selected_folders,
            candidate_scope,
        )
        connection = connect(self._database_path)
        try:
            total = int(
                connection.execute(
                    f"SELECT COUNT(*) FROM assets WHERE {where}", parameters
                ).fetchone()[0]
            )
            rows = connection.execute(
                f"""
                {ASSET_SUMMARY_SELECT}
                WHERE {where}
                ORDER BY relative_path COLLATE NOCASE
                LIMIT ? OFFSET ?
                """,
                [*parameters, limit, offset],
            ).fetchall()
            count_rows = connection.execute(
                f"""
                SELECT annotation_status, COUNT(*) AS count
                FROM assets
                WHERE {scope_where}
                GROUP BY annotation_status
                """,
                scope_parameters,
            ).fetchall()
            status_counts = {str(row["annotation_status"]): int(row["count"]) for row in count_rows}
            status_counts["all"] = sum(int(row["count"]) for row in count_rows)
            for review_status in (
                "needs_review",
                "failed",
                "unreviewed",
                "stale",
                *REVIEW_VALIDATION_STATUSES,
            ):
                review_where, review_parameters = self._asset_filter(
                    search,
                    review_status,
                    selected_folders,
                    candidate_scope,
                )
                status_counts[review_status] = int(
                    connection.execute(
                        f"SELECT COUNT(*) FROM assets WHERE {review_where}",
                        review_parameters,
                    ).fetchone()[0]
                )
            channels_by_asset = self._channel_statuses(connection, rows)
            items: list[AssetSummary] = []
            for row in rows:
                values = dict(row)
                values["annotation_channels"] = channels_by_asset.get(str(row["id"]), {})
                items.append(AssetSummary.model_validate(values))
            return items, total, status_counts
        finally:
            connection.close()

    def lookup(self, asset_id: str, query: AssetLookupRequest) -> AssetSummary | None:
        where, parameters = self._asset_filter(
            query.search,
            query.status,
            (query.folder_path,),
            query.candidate_scope,
        )
        connection = connect(self._database_path)
        try:
            row = connection.execute(
                f"{ASSET_SUMMARY_SELECT} WHERE {where} AND assets.id=?",
                [*parameters, asset_id],
            ).fetchone()
            if row is None:
                return None
            channels = self._channel_statuses(connection, [row])[asset_id]
            return AssetSummary.model_validate({**dict(row), "annotation_channels": channels})
        finally:
            connection.close()

    def list_asset_ids(
        self,
        *,
        search: str = "",
        annotation_status: str | None = None,
        folder_path: str = "",
        folder_paths: Sequence[str] = (),
        candidate_scope: CandidateScope = CandidateScope.AUTO,
    ) -> list[str]:
        selected_folders = tuple(dict.fromkeys((*folder_paths, folder_path)))
        where, parameters = self._asset_filter(
            search,
            annotation_status,
            selected_folders,
            candidate_scope,
        )
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
    def _asset_filter(
        search: str,
        annotation_status: str | None,
        folder_paths: Sequence[str] = (),
        candidate_scope: CandidateScope = CandidateScope.AUTO,
    ) -> tuple[str, list[object]]:
        clauses = [
            "assets.is_present = 1",
            candidate_scope_clause(candidate_scope, asset_alias="assets"),
        ]
        parameters: list[object] = []
        selected_folders = [folder_path for folder_path in folder_paths if folder_path]
        if selected_folders:
            folder_clauses: list[str] = []
            for folder_path in selected_folders:
                escaped_folder = (
                    folder_path.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
                )
                folder_clauses.append("assets.relative_path LIKE ? ESCAPE '\\'")
                parameters.append(f"{escaped_folder}/%")
            clauses.append(f"({' OR '.join(folder_clauses)})")
        if search:
            clauses.append("assets.relative_path LIKE ? ESCAPE '\\'")
            escaped = search.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
            parameters.append(f"%{escaped}%")
        if annotation_status == "failed":
            clauses.append(UNRESOLVED_GENERATION_FAILURE_SQL)
        elif annotation_status == "needs_review":
            clauses.append(NEEDS_REVIEW_SQL)
        elif annotation_status == "unreviewed":
            clauses.append(ACTIVE_UNREVIEWED_DOCUMENT_SQL)
        elif annotation_status == "stale":
            clauses.append(STALE_DOCUMENT_SQL)
        elif annotation_status in REVIEW_VALIDATION_STATUSES:
            clauses.append(
                """
                (
                    assets.annotation_status = ?
                    OR EXISTS (
                        SELECT 1
                        FROM annotation_documents d
                        JOIN annotation_document_revisions r
                          ON r.id = d.head_revision_id
                        WHERE d.asset_id = assets.id
                          AND r.is_tombstone = 0
                          AND r.validation_status = ?
                    )
                )
                """
            )
            parameters.extend((annotation_status, annotation_status))
        elif annotation_status:
            clauses.append("assets.annotation_status = ?")
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

    def get_assets(self, asset_ids: list[str]) -> dict[str, sqlite3.Row]:
        if not asset_ids:
            return {}
        rows: list[sqlite3.Row] = []
        connection = connect(self._database_path)
        try:
            for start in range(0, len(asset_ids), 500):
                batch = asset_ids[start : start + 500]
                placeholders = ", ".join("?" for _ in batch)
                rows.extend(
                    connection.execute(
                        f"""
                        SELECT *
                        FROM assets
                        WHERE id IN ({placeholders}) AND is_present = 1
                        """,
                        batch,
                    ).fetchall()
                )
        finally:
            connection.close()
        return {str(row["id"]): row for row in rows}

    def list_present_records(self) -> list[sqlite3.Row]:
        connection = connect(self._database_path)
        try:
            return connection.execute(
                """
                SELECT *
                FROM assets
                WHERE is_present = 1
                ORDER BY relative_path COLLATE NOCASE
                """
            ).fetchall()
        finally:
            connection.close()

    def list_present_paths(
        self,
        candidate_scope: CandidateScope = CandidateScope.ALL,
    ) -> list[str]:
        connection = connect(self._database_path)
        try:
            rows = connection.execute(
                f"""
                SELECT relative_path
                FROM assets
                WHERE is_present = 1
                  AND {candidate_scope_clause(candidate_scope, asset_alias="assets")}
                ORDER BY relative_path COLLATE NOCASE
                """
            ).fetchall()
            return [str(row["relative_path"]) for row in rows]
        finally:
            connection.close()

    def count_summary(self) -> tuple[int, int, int]:
        connection = connect(self._database_path)
        try:
            row = connection.execute(
                f"""
                SELECT
                    COUNT(*) AS total,
                    SUM(
                        EXISTS (
                            SELECT 1
                            FROM annotation_documents d
                            JOIN annotation_document_revisions r
                              ON r.id = d.head_revision_id
                            WHERE d.asset_id = assets.id
                              AND d.channel != 'translation'
                              AND r.is_tombstone = 0
                        )
                    ) AS annotated,
                    SUM(
                        EXISTS (
                            SELECT 1
                            FROM annotation_documents d
                            JOIN annotation_document_revisions r
                              ON r.id = d.head_revision_id
                            WHERE d.asset_id = assets.id
                              AND r.is_tombstone = 0
                              AND r.validation_status IN (
                                  'invalid', 'encoding_error', 'empty'
                              )
                        )
                        OR {UNRESOLVED_GENERATION_FAILURE_SQL}
                    ) AS invalid
                FROM assets
                WHERE is_present = 1
                """
            ).fetchone()
            return int(row["total"] or 0), int(row["annotated"] or 0), int(row["invalid"] or 0)
        finally:
            connection.close()

    @staticmethod
    def _channel_statuses(
        connection,
        assets,
    ) -> dict[str, dict[str, str]]:
        asset_ids = [str(asset["id"]) for asset in assets]
        if not asset_ids:
            return {}
        statuses: dict[str, dict[str, str]] = {asset_id: {} for asset_id in asset_ids}
        for start in range(0, len(asset_ids), 500):
            batch = asset_ids[start : start + 500]
            placeholders = ",".join("?" for _ in batch)
            rows = connection.execute(
                f"""
                SELECT d.asset_id, d.channel, d.language,
                       d.translation_source_kind, d.translation_producer_kind,
                       d.head_revision_id, d.reviewed_revision_id,
                       r.is_tombstone, r.image_content_hash,
                       r.validation_status,
                       a.content_hash AS current_image_hash,
                       {document_state_projection_sql()}
                FROM annotation_documents d
                JOIN assets a ON a.id = d.asset_id
                LEFT JOIN annotation_document_revisions r
                  ON r.id = d.head_revision_id
                WHERE d.asset_id IN ({placeholders})
                """,
                batch,
            ).fetchall()
            for row in rows:
                key = str(row["channel"])
                if key == "translation":
                    key = (
                        f"{key}:{row['translation_source_kind']}:"
                        f"{row['translation_producer_kind']}:{row['language']}"
                    )
                state = resolve_document_row_state(row)
                if state.availability_status.value != "usable":
                    status = (
                        state.validation_status.value
                        if state.availability_status.value == "invalid"
                        and state.validation_status is not None
                        else state.availability_status.value
                    )
                elif state.review_status is not None:
                    status = state.review_status.value
                else:
                    status = "missing"
                statuses[str(row["asset_id"])][key] = status
        return statuses
