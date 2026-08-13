from __future__ import annotations

import json
import sqlite3
import uuid
from dataclasses import dataclass
from pathlib import Path

from dataset_studio.core.sqlite import connect, transaction
from dataset_studio.core.time import utc_now_iso
from dataset_studio.modules.screening.metadata import MetadataReadResult
from dataset_studio.modules.screening.models import (
    SCORE_MODE,
    SCORE_VERSION,
    ScreeningItem,
    ScreeningItemList,
    ScreeningOperation,
    ScreeningOperationStatus,
    ScreeningRequest,
)
from dataset_studio.modules.screening.scoring import ScoringOutput

ACTIVE_STATUSES = ("queued", "running", "stopping")
ITEM_SORTS = {
    "priority": """
        CASE candidate_pool
            WHEN 'elite_candidate' THEN 0
            WHEN 'recommended' THEN 1
            WHEN 'low_evidence_protected' THEN 2
            WHEN 'review' THEN 3
            WHEN 'low_priority_high_confidence' THEN 4
            WHEN 'quarantine' THEN 5
            ELSE 6
        END, rating, rating_percentile DESC, source_relative_path COLLATE NOCASE
    """,
    "percentile": "rating, rating_percentile DESC, source_relative_path COLLATE NOCASE",
    "score": "rating, final_score DESC, source_relative_path COLLATE NOCASE",
    "path": "source_relative_path COLLATE NOCASE",
}


@dataclass(frozen=True, slots=True)
class MetadataBatchUpdate:
    item_id: str
    result: MetadataReadResult | None = None
    candidate_pool: str | None = None
    error_code: str | None = None
    error_message: str | None = None
    warnings: tuple[str, ...] = ()


class ScreeningRepository:
    def __init__(self, database_path: Path) -> None:
        self._database_path = database_path

    def create(
        self,
        operation_id: str,
        request: ScreeningRequest,
        assets: list[sqlite3.Row],
        metadata_stats: dict[str, tuple[int, int]],
    ) -> None:
        now = utc_now_iso()
        configuration = {
            "score_mode": SCORE_MODE,
            "score_version": SCORE_VERSION,
            "task_profile": request.task_profile.value,
            "intensity": request.intensity.value,
            "metadata_snapshot_at": (
                request.metadata_snapshot_at.isoformat() if request.metadata_snapshot_at else None
            ),
            "reference_mode": "batch_only",
            "disabled_signals": [
                "global_archive_cdf",
                "character_copyright_debias",
                "artist_rescue",
                "beta_lower_bound",
                "historical_trend",
            ],
        }
        with transaction(self._database_path) as connection:
            connection.execute(
                """
                INSERT INTO screening_operations (
                    id, status, score_mode, score_version, total_items,
                    configuration_snapshot, created_at, updated_at
                ) VALUES (?, 'queued', ?, ?, ?, ?, ?, ?)
                """,
                (
                    operation_id,
                    SCORE_MODE,
                    SCORE_VERSION,
                    len(assets),
                    _json(configuration),
                    now,
                    now,
                ),
            )
            item_rows: list[tuple[object, ...]] = []
            for position, asset in enumerate(assets):
                metadata_path = (
                    str(asset["metadata_relative_path"])
                    if asset["metadata_relative_path"] is not None
                    else None
                )
                metadata_size, metadata_modified_ns = metadata_stats.get(
                    str(asset["id"]), (None, None)
                )
                item_rows.append(
                    (
                        str(uuid.uuid4()),
                        operation_id,
                        position,
                        str(asset["id"]),
                        str(asset["relative_path"]),
                        str(asset["content_hash"]),
                        int(asset["byte_size"]),
                        int(asset["modified_ns"]),
                        int(asset["width"]) if asset["width"] is not None else 0,
                        int(asset["height"]) if asset["height"] is not None else 0,
                        metadata_path,
                        metadata_size,
                        metadata_modified_ns,
                        now,
                        now,
                    ),
                )
            connection.executemany(
                """
                INSERT INTO screening_items (
                    id, operation_id, position, asset_id,
                    source_relative_path, image_hash, image_size,
                    image_modified_ns, image_width, image_height,
                    metadata_relative_path, metadata_size, metadata_modified_ns,
                    created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                item_rows,
            )

    def list(self, *, limit: int) -> list[ScreeningOperation]:
        connection = connect(self._database_path)
        try:
            rows = connection.execute(
                "SELECT * FROM screening_operations ORDER BY created_at DESC, rowid DESC LIMIT ?",
                (limit,),
            ).fetchall()
            return [self._operation(row) for row in rows]
        finally:
            connection.close()

    def get(self, operation_id: str) -> ScreeningOperation | None:
        connection = connect(self._database_path)
        try:
            row = connection.execute(
                "SELECT * FROM screening_operations WHERE id = ?", (operation_id,)
            ).fetchone()
            return self._operation(row) if row else None
        finally:
            connection.close()

    def claim_next_operation(self) -> ScreeningOperation | None:
        now = utc_now_iso()
        with transaction(self._database_path) as connection:
            row = connection.execute(
                """
                SELECT id FROM screening_operations
                WHERE status = 'queued' AND stop_requested = 0
                ORDER BY created_at, rowid LIMIT 1
                """
            ).fetchone()
            if row is None:
                return None
            changed = connection.execute(
                """
                UPDATE screening_operations
                SET status = 'running', started_at = COALESCE(started_at, ?),
                    completed_at = NULL, error_message = NULL, updated_at = ?
                WHERE id = ? AND status = 'queued' AND stop_requested = 0
                """,
                (now, now, str(row["id"])),
            ).rowcount
            if not changed:
                return None
            claimed = connection.execute(
                "SELECT * FROM screening_operations WHERE id = ?", (str(row["id"]),)
            ).fetchone()
            return self._operation(claimed)

    def pending_rows(self, operation_id: str) -> list[sqlite3.Row]:
        connection = connect(self._database_path)
        try:
            return connection.execute(
                """
                SELECT * FROM screening_items
                WHERE operation_id = ? AND status = 'pending'
                ORDER BY position
                """,
                (operation_id,),
            ).fetchall()
        finally:
            connection.close()

    def save_metadata_batch(
        self,
        operation_id: str,
        updates: list[MetadataBatchUpdate],
        *,
        current_relative_path: str | None,
    ) -> None:
        if not updates:
            return
        now = utc_now_iso()
        normalized_rows: list[tuple[object, ...]] = []
        failed_rows: list[tuple[object, ...]] = []
        invalid_count = 0
        for update in updates:
            if update.candidate_pool is not None:
                invalid_count += 1
            if update.result is None:
                reasons = [
                    "METADATA_ERROR"
                    if update.candidate_pool == "invalid"
                    else "DANBOORU_QUARANTINE"
                ]
                failed_rows.append(
                    (
                        update.candidate_pool or "invalid",
                        _json(reasons),
                        _json(list(update.warnings)),
                        update.error_code,
                        update.error_message,
                        now,
                        update.item_id,
                        operation_id,
                    )
                )
                continue
            result = update.result
            metadata = result.metadata
            reasons = (
                []
                if update.candidate_pool is None
                else [
                    "METADATA_ERROR"
                    if update.candidate_pool == "invalid"
                    else "DANBOORU_QUARANTINE"
                ]
            )
            warnings = update.warnings or metadata.warnings
            normalized_rows.append(
                (
                    "parsed" if update.candidate_pool is None else "invalid",
                    result.byte_size,
                    result.modified_ns,
                    result.content_hash,
                    metadata.rating,
                    metadata.created_at,
                    metadata.metadata_snapshot_at,
                    metadata.age_hours,
                    metadata.age_bucket,
                    metadata.fav_count,
                    metadata.up_score,
                    metadata.downvote_count,
                    metadata.evidence_mass,
                    _json(metadata.snapshot()),
                    update.candidate_pool,
                    _json(reasons),
                    _json(list(warnings)),
                    update.error_code,
                    update.error_message,
                    now,
                    update.item_id,
                    operation_id,
                )
            )
        with transaction(self._database_path) as connection:
            changes_before = connection.total_changes
            if normalized_rows:
                connection.executemany(
                    """
                    UPDATE screening_items
                    SET status = ?, metadata_size = ?, metadata_modified_ns = ?,
                        metadata_hash = ?, rating = ?, created_at_source = ?,
                        metadata_snapshot_at = ?, age_hours = ?, age_bucket = ?,
                        fav_count = ?, up_score = ?, downvote_count = ?,
                        evidence_mass = ?, normalized_snapshot = ?, candidate_pool = ?,
                        reason_codes = ?, warnings = ?, error_code = ?, error_message = ?,
                        updated_at = ?
                    WHERE id = ? AND operation_id = ? AND status = 'pending'
                    """,
                    normalized_rows,
                )
            if failed_rows:
                connection.executemany(
                    """
                    UPDATE screening_items
                    SET status = 'invalid', candidate_pool = ?, reason_codes = ?, warnings = ?,
                        error_code = ?, error_message = ?, updated_at = ?
                    WHERE id = ? AND operation_id = ? AND status = 'pending'
                    """,
                    failed_rows,
                )
            changed = connection.total_changes - changes_before
            if changed != len(updates):
                raise RuntimeError(
                    f"筛选元数据批次应更新 {len(updates)} 项，实际更新 {changed} 项。"
                )
            connection.execute(
                """
                UPDATE screening_operations
                SET processed_items = processed_items + ?,
                    invalid_items = invalid_items + ?,
                    current_relative_path = ?, updated_at = ?
                WHERE id = ?
                """,
                (len(updates), invalid_count, current_relative_path, now, operation_id),
            )

    def parsed_rows(self, operation_id: str):
        connection = connect(self._database_path)
        try:
            return connection.execute(
                """
                SELECT * FROM screening_items
                WHERE operation_id = ? AND status = 'parsed'
                ORDER BY position
                """,
                (operation_id,),
            ).fetchall()
        finally:
            connection.close()

    def save_scores(self, operation_id: str, outputs: list[ScoringOutput]) -> None:
        now = utc_now_iso()
        score_rows = [
            (
                output.confidence_pop,
                output.confidence_depth,
                output.confidence_vote,
                output.technical_score,
                output.keep_score,
                output.elite_score,
                output.final_score,
                output.rating_rank,
                output.rating_percentile,
                output.candidate_pool,
                int(output.low_resolution_flag),
                output.pixel_duplicate_group,
                output.variant_group,
                int(output.duplicate_representative),
                output.duplicate_of_asset_id,
                _json(output.score_details),
                _json(list(output.reason_codes)),
                now,
                output.item_id,
                operation_id,
            )
            for output in outputs
        ]
        with transaction(self._database_path) as connection:
            changes_before = connection.total_changes
            connection.executemany(
                """
                UPDATE screening_items
                SET status = 'scored', confidence_pop = ?, confidence_depth = ?,
                    confidence_vote = ?, technical_score = ?, keep_score = ?,
                    elite_score = ?, final_score = ?, rating_rank = ?,
                    rating_percentile = ?, candidate_pool = ?,
                    low_resolution_flag = ?, pixel_duplicate_group = ?,
                    variant_group = ?, duplicate_representative = ?,
                    duplicate_of_asset_id = ?,
                    score_details = ?, reason_codes = ?, updated_at = ?
                WHERE id = ? AND operation_id = ? AND status = 'parsed'
                """,
                score_rows,
            )
            scored = connection.total_changes - changes_before
            if scored != len(outputs):
                raise RuntimeError(f"筛选评分应更新 {len(outputs)} 项，实际更新 {scored} 项。")
            connection.execute(
                """
                UPDATE screening_operations
                SET scored_items = scored_items + ?, current_relative_path = NULL, updated_at = ?
                WHERE id = ?
                """,
                (scored, now, operation_id),
            )

    def complete(self, operation_id: str) -> None:
        now = utc_now_iso()
        with transaction(self._database_path) as connection:
            pending = int(
                connection.execute(
                    """
                    SELECT COUNT(*) FROM screening_items
                    WHERE operation_id = ? AND status IN ('pending', 'parsed')
                    """,
                    (operation_id,),
                ).fetchone()[0]
            )
            if pending:
                raise RuntimeError(f"筛选任务仍有 {pending} 个未完成条目。")
            pool_counts = {
                str(row["candidate_pool"]): int(row["count"])
                for row in connection.execute(
                    """
                    SELECT candidate_pool, COUNT(*) AS count
                    FROM screening_items WHERE operation_id = ?
                    GROUP BY candidate_pool
                    """,
                    (operation_id,),
                ).fetchall()
            }
            rating_counts = {
                str(row["rating"]): int(row["count"])
                for row in connection.execute(
                    """
                    SELECT rating, COUNT(*) AS count
                    FROM screening_items
                    WHERE operation_id = ? AND rating IS NOT NULL
                    GROUP BY rating
                    """,
                    (operation_id,),
                ).fetchall()
            }
            connection.execute(
                """
                UPDATE screening_operations
                SET status = 'completed', processed_items = total_items,
                    pool_counts_snapshot = ?, rating_counts_snapshot = ?,
                    completed_at = ?, current_relative_path = NULL, updated_at = ?
                WHERE id = ?
                """,
                (_json(pool_counts), _json(rating_counts), now, now, operation_id),
            )

    def fail(self, operation_id: str, message: str) -> None:
        now = utc_now_iso()
        with transaction(self._database_path) as connection:
            connection.execute(
                """
                UPDATE screening_operations SET status = 'failed', error_message = ?,
                    current_relative_path = NULL, completed_at = ?, updated_at = ? WHERE id = ?
                """,
                (message, now, now, operation_id),
            )

    def request_stop(self, operation_id: str) -> bool:
        now = utc_now_iso()
        with transaction(self._database_path) as connection:
            row = connection.execute(
                "SELECT status FROM screening_operations WHERE id = ?", (operation_id,)
            ).fetchone()
            if row is None or str(row["status"]) not in ACTIVE_STATUSES:
                return False
            if str(row["status"]) == "queued":
                connection.execute(
                    """
                    UPDATE screening_operations
                    SET status = 'stopped', stop_requested = 1,
                        completed_at = ?, updated_at = ?
                    WHERE id = ?
                    """,
                    (now, now, operation_id),
                )
            else:
                connection.execute(
                    """
                    UPDATE screening_operations
                    SET status = 'stopping', stop_requested = 1, updated_at = ?
                    WHERE id = ?
                    """,
                    (now, operation_id),
                )
            return True

    def request_stop_all(self) -> int:
        now = utc_now_iso()
        with transaction(self._database_path) as connection:
            queued = connection.execute(
                """
                UPDATE screening_operations
                SET status = 'stopped', stop_requested = 1,
                    completed_at = ?, updated_at = ?
                WHERE status = 'queued'
                """,
                (now, now),
            ).rowcount
            running = connection.execute(
                """
                UPDATE screening_operations
                SET status = 'stopping', stop_requested = 1, updated_at = ?
                WHERE status IN ('running', 'stopping')
                """,
                (now,),
            ).rowcount
            return queued + running

    def is_stop_requested(self, operation_id: str) -> bool:
        operation = self.get(operation_id)
        return operation is not None and operation.status == ScreeningOperationStatus.STOPPING

    def mark_stopped(self, operation_id: str) -> None:
        self._mark_inactive(operation_id, "stopped")

    def mark_interrupted(self, operation_id: str) -> None:
        self._mark_inactive(operation_id, "interrupted")

    def _mark_inactive(self, operation_id: str, status: str) -> None:
        now = utc_now_iso()
        with transaction(self._database_path) as connection:
            connection.execute(
                """
                UPDATE screening_operations
                SET status = ?, current_relative_path = NULL,
                    completed_at = ?, updated_at = ?
                WHERE id = ?
                """,
                (status, now, now, operation_id),
            )

    def resume(self, operation_id: str) -> bool:
        now = utc_now_iso()
        with transaction(self._database_path) as connection:
            if connection.execute(
                """
                SELECT 1 FROM screening_operations
                WHERE status IN ('queued', 'running', 'stopping') LIMIT 1
                """
            ).fetchone():
                raise ValueError("当前项目已有筛选任务正在进行。")
            return bool(
                connection.execute(
                    """
                UPDATE screening_operations SET status = 'queued', stop_requested = 0,
                    completed_at = NULL, error_message = NULL, updated_at = ?
                WHERE id = ? AND status IN ('stopped', 'interrupted')
                """,
                    (now, operation_id),
                ).rowcount
            )

    def recover_orphaned(self) -> list[str]:
        now = utc_now_iso()
        with transaction(self._database_path) as connection:
            ids = [
                str(row["id"])
                for row in connection.execute(
                    "SELECT id FROM screening_operations WHERE status IN ('running', 'stopping')"
                ).fetchall()
            ]
            if ids:
                connection.execute(
                    """
                    UPDATE screening_operations
                    SET status = 'interrupted', current_relative_path = NULL,
                        completed_at = ?, updated_at = ?
                    WHERE status IN ('running', 'stopping')
                    """,
                    (now, now),
                )
            return ids

    def active_count(self) -> int:
        connection = connect(self._database_path)
        try:
            return int(
                connection.execute(
                    """
                    SELECT COUNT(*) FROM screening_operations
                    WHERE status IN ('queued', 'running', 'stopping')
                    """
                ).fetchone()[0]
            )
        finally:
            connection.close()

    def list_items(
        self,
        operation_id: str,
        *,
        offset: int,
        limit: int,
        candidate_pool: str | None,
        rating: str | None,
        low_resolution: bool | None,
        duplicate_variant: bool | None,
        sort: str,
    ) -> ScreeningItemList:
        where, params = self._item_filter(
            operation_id, candidate_pool, rating, low_resolution, duplicate_variant
        )
        order = ITEM_SORTS.get(sort, ITEM_SORTS["priority"])
        connection = connect(self._database_path)
        try:
            total = int(
                connection.execute(
                    f"SELECT COUNT(*) FROM screening_items WHERE {where}", params
                ).fetchone()[0]
            )
            rows = connection.execute(
                f"SELECT * FROM screening_items WHERE {where} ORDER BY {order} LIMIT ? OFFSET ?",
                (*params, limit, offset),
            ).fetchall()
            return ScreeningItemList(
                items=[self._item(row) for row in rows],
                total=total,
                offset=offset,
                limit=limit,
            )
        finally:
            connection.close()

    def get_item(self, operation_id: str, asset_id: str) -> ScreeningItem | None:
        connection = connect(self._database_path)
        try:
            row = connection.execute(
                "SELECT * FROM screening_items WHERE operation_id = ? AND asset_id = ?",
                (operation_id, asset_id),
            ).fetchone()
            return self._item(row) if row else None
        finally:
            connection.close()

    def asset_ids(
        self,
        operation_id: str,
        *,
        candidate_pool: str | None,
        rating: str | None,
        low_resolution: bool | None,
        duplicate_variant: bool | None,
    ) -> list[str]:
        where, params = self._item_filter(
            operation_id, candidate_pool, rating, low_resolution, duplicate_variant
        )
        connection = connect(self._database_path)
        try:
            rows = connection.execute(
                f"SELECT asset_id FROM screening_items WHERE {where} ORDER BY position", params
            ).fetchall()
            return [str(row["asset_id"]) for row in rows]
        finally:
            connection.close()

    @staticmethod
    def _item_filter(operation_id, candidate_pool, rating, low_resolution, duplicate_variant):
        clauses = ["operation_id = ?"]
        params: list[object] = [operation_id]
        if candidate_pool:
            clauses.append("candidate_pool = ?")
            params.append(candidate_pool)
        if rating:
            clauses.append("rating = ?")
            params.append(rating)
        if low_resolution is not None:
            clauses.append("low_resolution_flag = ?")
            params.append(int(low_resolution))
        if duplicate_variant is not None:
            clauses.append("(pixel_duplicate_group IS NOT NULL OR variant_group IS NOT NULL) = ?")
            params.append(int(duplicate_variant))
        return " AND ".join(clauses), params

    @staticmethod
    def _operation(row) -> ScreeningOperation:
        return ScreeningOperation(
            id=str(row["id"]),
            status=str(row["status"]),
            score_mode=str(row["score_mode"]),
            score_version=str(row["score_version"]),
            total_items=int(row["total_items"]),
            processed_items=int(row["processed_items"]),
            scored_items=int(row["scored_items"]),
            invalid_items=int(row["invalid_items"]),
            current_relative_path=row["current_relative_path"],
            configuration_snapshot=_object(row["configuration_snapshot"]),
            pool_counts={k: int(v) for k, v in _object(row["pool_counts_snapshot"]).items()},
            rating_counts={k: int(v) for k, v in _object(row["rating_counts_snapshot"]).items()},
            created_at=str(row["created_at"]),
            updated_at=str(row["updated_at"]),
            started_at=row["started_at"],
            completed_at=row["completed_at"],
            error_message=row["error_message"],
        )

    @staticmethod
    def _item(row) -> ScreeningItem:
        details = _object(row["score_details"]) if row["score_details"] else None
        return ScreeningItem(
            asset_id=str(row["asset_id"]),
            source_relative_path=str(row["source_relative_path"]),
            image_width=(
                int(row["image_width"])
                if row["image_width"] is not None and int(row["image_width"]) > 0
                else None
            ),
            image_height=(
                int(row["image_height"])
                if row["image_height"] is not None and int(row["image_height"]) > 0
                else None
            ),
            metadata_relative_path=row["metadata_relative_path"],
            status=str(row["status"]),
            rating=row["rating"],
            created_at=row["created_at_source"],
            metadata_snapshot_at=row["metadata_snapshot_at"],
            age_hours=row["age_hours"],
            age_bucket=row["age_bucket"],
            fav_count=row["fav_count"],
            up_score=row["up_score"],
            downvote_count=row["downvote_count"],
            evidence_mass=row["evidence_mass"],
            confidence_pop=row["confidence_pop"],
            confidence_depth=row["confidence_depth"],
            confidence_vote=row["confidence_vote"],
            technical_score=row["technical_score"],
            keep_score=row["keep_score"],
            elite_score=row["elite_score"],
            final_score=row["final_score"],
            rating_rank=row["rating_rank"],
            rating_percentile=row["rating_percentile"],
            candidate_pool=row["candidate_pool"],
            low_resolution_flag=bool(row["low_resolution_flag"]),
            pixel_duplicate_group=row["pixel_duplicate_group"],
            variant_group=row["variant_group"],
            duplicate_representative=bool(row["duplicate_representative"]),
            duplicate_of_asset_id=row["duplicate_of_asset_id"],
            score_details=details,
            reason_codes=_array(row["reason_codes"]),
            warnings=_array(row["warnings"]),
            error_code=row["error_code"],
            error_message=row["error_message"],
        )


def _json(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def _object(value: object) -> dict[str, object]:
    try:
        parsed = json.loads(str(value))
    except (json.JSONDecodeError, TypeError):
        return {}
    return parsed if isinstance(parsed, dict) else {}


def _array(value: object) -> list[str]:
    try:
        parsed = json.loads(str(value))
    except (json.JSONDecodeError, TypeError):
        return []
    return [str(entry) for entry in parsed] if isinstance(parsed, list) else []
