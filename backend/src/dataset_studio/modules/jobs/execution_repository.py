from __future__ import annotations

import uuid
from dataclasses import dataclass
from pathlib import Path

from dataset_studio.core.sqlite import connect, transaction
from dataset_studio.core.time import utc_now_iso
from dataset_studio.modules.jobs.models import JobItemStatus, JobStatus


@dataclass(frozen=True, slots=True)
class AttemptCompletion:
    attempt_id: str
    status: str
    response_content: str | None = None
    error_message: str | None = None
    provider_payload_path: str | None = None
    finish_reason: str | None = None


@dataclass(frozen=True, slots=True)
class ItemCompletion:
    item_id: str
    status: JobItemStatus
    error: str | None = None
    validation_status: str | None = None
    manually_accepted: bool = False


class JobExecutionRepository:
    """Atomic queue claiming, attempt recording and lifecycle transitions."""

    def __init__(self, database_path: Path) -> None:
        self._database_path = database_path

    def runnable_jobs(self) -> list[dict[str, object]]:
        connection = connect(self._database_path)
        try:
            rows = connection.execute(
                """
                SELECT * FROM jobs
                WHERE status IN ('queued', 'running') AND stop_requested = 0
                ORDER BY created_at
                """
            ).fetchall()
            return [dict(row) for row in rows]
        finally:
            connection.close()

    def claim_items(self, job_id: str, limit: int) -> list[dict[str, object]]:
        if limit <= 0:
            return []
        with transaction(self._database_path) as connection:
            job = connection.execute(
                "SELECT stop_requested FROM jobs WHERE id = ?", (job_id,)
            ).fetchone()
            if job is None or bool(job["stop_requested"]):
                return []
            rows = connection.execute(
                """
                SELECT ji.*, a.relative_path, a.annotation_relative_path
                FROM job_items ji
                JOIN assets a ON a.id = ji.asset_id
                WHERE ji.job_id = ? AND ji.status = 'pending'
                ORDER BY a.relative_path COLLATE NOCASE
                LIMIT ?
                """,
                (job_id, limit),
            ).fetchall()
            now = utc_now_iso()
            for row in rows:
                connection.execute(
                    "UPDATE job_items SET status = ?, updated_at = ? WHERE id = ?",
                    (JobItemStatus.RUNNING.value, now, row["id"]),
                )
            if rows:
                connection.execute(
                    "UPDATE jobs SET status = ?, updated_at = ? WHERE id = ?",
                    (JobStatus.RUNNING.value, now, job_id),
                )
            return [dict(row) for row in rows]

    def start_attempt(
        self,
        item_id: str,
        *,
        source_annotation_hash: str | None = None,
    ) -> tuple[str, int]:
        attempt_id = str(uuid.uuid4())
        now = utc_now_iso()
        with transaction(self._database_path) as connection:
            row = connection.execute(
                """
                SELECT ji.attempt_count,
                       COALESCE(MAX(ja.attempt_number), 0) AS last_attempt_number
                FROM job_items ji
                LEFT JOIN job_attempts ja ON ja.job_item_id = ji.id
                WHERE ji.id = ?
                GROUP BY ji.id
                """,
                (item_id,),
            ).fetchone()
            if row is None:
                raise ValueError(f"找不到任务条目：{item_id}")
            cycle_attempt_count = int(row["attempt_count"]) + 1
            attempt_number = int(row["last_attempt_number"]) + 1
            connection.execute(
                "UPDATE job_items SET attempt_count = ?, updated_at = ? WHERE id = ?",
                (cycle_attempt_count, now, item_id),
            )
            connection.execute(
                """
                INSERT INTO job_attempts (
                    id, job_item_id, attempt_number, status, started_at,
                    source_annotation_hash
                ) VALUES (?, ?, ?, 'running', ?, ?)
                """,
                (attempt_id, item_id, attempt_number, now, source_annotation_hash),
            )
        return attempt_id, attempt_number

    def start_attempts(self, item_ids: list[str]) -> dict[str, tuple[str, int]]:
        if not item_ids:
            return {}
        if len(item_ids) != len(set(item_ids)):
            raise ValueError("批量创建任务尝试时包含重复条目。")
        started: dict[str, tuple[str, int]] = {}
        now = utc_now_iso()
        with transaction(self._database_path) as connection:
            for item_id in item_ids:
                row = connection.execute(
                    """
                    SELECT ji.attempt_count,
                           COALESCE(MAX(ja.attempt_number), 0) AS last_attempt_number
                    FROM job_items ji
                    LEFT JOIN job_attempts ja ON ja.job_item_id = ji.id
                    WHERE ji.id = ?
                    GROUP BY ji.id
                    """,
                    (item_id,),
                ).fetchone()
                if row is None:
                    raise ValueError(f"找不到任务条目：{item_id}")
                cycle_attempt_count = int(row["attempt_count"]) + 1
                attempt_number = int(row["last_attempt_number"]) + 1
                attempt_id = str(uuid.uuid4())
                connection.execute(
                    "UPDATE job_items SET attempt_count = ?, updated_at = ? WHERE id = ?",
                    (cycle_attempt_count, now, item_id),
                )
                connection.execute(
                    """
                    INSERT INTO job_attempts (
                        id, job_item_id, attempt_number, status, started_at,
                        source_annotation_hash
                    ) VALUES (?, ?, ?, 'running', ?, NULL)
                    """,
                    (attempt_id, item_id, attempt_number, now),
                )
                started[item_id] = (attempt_id, attempt_number)
        return started

    def finish_attempt(
        self,
        attempt_id: str,
        *,
        status: str,
        response_content: str | None = None,
        error_message: str | None = None,
        provider_payload_path: str | None = None,
        input_tokens: int | None = None,
        output_tokens: int | None = None,
        cache_read_tokens: int | None = None,
        cache_write_tokens: int | None = None,
        reasoning_tokens: int | None = None,
        finish_reason: str | None = None,
    ) -> None:
        with transaction(self._database_path) as connection:
            connection.execute(
                """
                UPDATE job_attempts
                SET status = ?, response_content = ?, error_message = ?,
                    provider_payload_path = ?, finished_at = ?, input_tokens = ?,
                    output_tokens = ?, cache_read_tokens = ?, cache_write_tokens = ?,
                    reasoning_tokens = ?, finish_reason = ?
                WHERE id = ?
                """,
                (
                    status,
                    response_content,
                    error_message,
                    provider_payload_path,
                    utc_now_iso(),
                    input_tokens,
                    output_tokens,
                    cache_read_tokens,
                    cache_write_tokens,
                    reasoning_tokens,
                    finish_reason,
                    attempt_id,
                ),
            )

    def finish_item(
        self,
        item_id: str,
        status: JobItemStatus,
        *,
        error: str | None = None,
        validation_status: str | None = None,
        manually_accepted: bool = False,
    ) -> None:
        with transaction(self._database_path) as connection:
            connection.execute(
                """
                UPDATE job_items
                SET status = ?, last_error = ?, validation_status = ?,
                    manually_accepted = ?, updated_at = ?
                WHERE id = ?
                """,
                (
                    status.value,
                    error,
                    validation_status,
                    int(manually_accepted),
                    utc_now_iso(),
                    item_id,
                ),
            )

    def finish_batch(
        self,
        attempts: list[AttemptCompletion],
        items: list[ItemCompletion],
    ) -> None:
        if not attempts and not items:
            return
        now = utc_now_iso()
        with transaction(self._database_path) as connection:
            for attempt in attempts:
                connection.execute(
                    """
                    UPDATE job_attempts
                    SET status = ?, response_content = ?, error_message = ?,
                        provider_payload_path = ?, finished_at = ?,
                        finish_reason = ?
                    WHERE id = ?
                    """,
                    (
                        attempt.status,
                        attempt.response_content,
                        attempt.error_message,
                        attempt.provider_payload_path,
                        now,
                        attempt.finish_reason,
                        attempt.attempt_id,
                    ),
                )
            for item in items:
                connection.execute(
                    """
                    UPDATE job_items
                    SET status = ?, last_error = ?, validation_status = ?,
                        manually_accepted = ?, updated_at = ?
                    WHERE id = ?
                    """,
                    (
                        item.status.value,
                        item.error,
                        item.validation_status,
                        int(item.manually_accepted),
                        now,
                        item.item_id,
                    ),
                )

    def is_stop_requested(self, job_id: str) -> bool:
        connection = connect(self._database_path)
        try:
            row = connection.execute(
                "SELECT stop_requested FROM jobs WHERE id = ?", (job_id,)
            ).fetchone()
            return bool(row and row["stop_requested"])
        finally:
            connection.close()

    def running_count(self, job_id: str) -> int:
        connection = connect(self._database_path)
        try:
            return int(
                connection.execute(
                    "SELECT COUNT(*) FROM job_items WHERE job_id = ? AND status = 'running'",
                    (job_id,),
                ).fetchone()[0]
            )
        finally:
            connection.close()
