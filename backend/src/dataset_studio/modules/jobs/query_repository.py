from __future__ import annotations

import json
from pathlib import Path

from dataset_studio.core.sqlite import connect
from dataset_studio.modules.jobs.models import (
    JobAttempt,
    JobDetail,
    JobItemDetail,
    JobItemStatus,
    JobSummary,
)


class JobQueryRepository:
    """Read-only job projections for the API and review interface."""

    def __init__(self, database_path: Path) -> None:
        self._database_path = database_path

    def list_jobs(self, limit: int = 100) -> list[JobSummary]:
        connection = connect(self._database_path)
        try:
            rows = connection.execute(
                "SELECT * FROM jobs ORDER BY created_at DESC LIMIT ?", (limit,)
            ).fetchall()
            return [self._summary(connection, row) for row in rows]
        finally:
            connection.close()

    def get_job(self, job_id: str, *, include_items: bool = True) -> JobDetail | None:
        connection = connect(self._database_path)
        try:
            row = connection.execute("SELECT * FROM jobs WHERE id = ?", (job_id,)).fetchone()
            if row is None:
                return None
            summary = self._summary(connection, row)
            items = self._items(connection, job_id) if include_items else []
            return JobDetail(**summary.model_dump(), items=items)
        finally:
            connection.close()

    def latest_failed_response(self, job_id: str, item_id: str) -> tuple[str, str] | None:
        connection = connect(self._database_path)
        try:
            row = connection.execute(
                """
                SELECT ji.asset_id, ja.response_content
                FROM job_items ji
                JOIN job_attempts ja ON ja.job_item_id = ji.id
                WHERE ji.job_id = ? AND ji.id = ? AND ja.response_content IS NOT NULL
                ORDER BY ja.attempt_number DESC
                LIMIT 1
                """,
                (job_id, item_id),
            ).fetchone()
            if row is None:
                return None
            return str(row["asset_id"]), str(row["response_content"])
        finally:
            connection.close()

    def get_job_row(self, job_id: str) -> dict[str, object] | None:
        connection = connect(self._database_path)
        try:
            row = connection.execute("SELECT * FROM jobs WHERE id = ?", (job_id,)).fetchone()
            return dict(row) if row else None
        finally:
            connection.close()

    @staticmethod
    def _items(connection, job_id: str) -> list[JobItemDetail]:
        item_rows = connection.execute(
            """
            SELECT ji.*, a.relative_path
            FROM job_items ji
            JOIN assets a ON a.id = ji.asset_id
            WHERE ji.job_id = ?
            ORDER BY a.relative_path COLLATE NOCASE
            """,
            (job_id,),
        ).fetchall()
        items: list[JobItemDetail] = []
        for item_row in item_rows:
            attempt_rows = connection.execute(
                """
                SELECT id, attempt_number, status, response_content, error_message,
                       started_at, finished_at, input_tokens, output_tokens, finish_reason
                FROM job_attempts
                WHERE job_item_id = ?
                ORDER BY attempt_number
                """,
                (item_row["id"],),
            ).fetchall()
            values = dict(item_row)
            values["manually_accepted"] = bool(item_row["manually_accepted"])
            items.append(
                JobItemDetail(
                    **values,
                    attempts=[JobAttempt.model_validate(dict(attempt)) for attempt in attempt_rows],
                )
            )
        return items

    @staticmethod
    def _summary(connection, row) -> JobSummary:
        counts = {
            str(count_row["status"]): int(count_row["count"])
            for count_row in connection.execute(
                "SELECT status, COUNT(*) AS count FROM job_items WHERE job_id = ? GROUP BY status",
                (row["id"],),
            )
        }
        provider = json.loads(str(row["provider_snapshot"]))
        system = json.loads(str(row["system_prompt_snapshot"]))
        return JobSummary(
            id=str(row["id"]),
            status=str(row["status"]),
            system_preset_id=str(row["system_preset_id"]),
            system_preset_name=str(system.get("name", "未命名预设")),
            provider_profile_id=str(row["provider_profile_id"]),
            provider_profile_name=str(provider.get("name", "未命名 API 配置")),
            scope=str(row["scope"]),
            overwrite_existing=bool(row["overwrite_existing"]),
            retry_limit=int(row["retry_limit"]),
            total=sum(counts.values()),
            pending=counts.get(JobItemStatus.PENDING.value, 0)
            + counts.get(JobItemStatus.INTERRUPTED.value, 0),
            running=counts.get(JobItemStatus.RUNNING.value, 0),
            succeeded=counts.get(JobItemStatus.SUCCEEDED.value, 0),
            failed=counts.get(JobItemStatus.FAILED.value, 0),
            skipped=counts.get(JobItemStatus.SKIPPED.value, 0),
            manually_accepted=counts.get(JobItemStatus.MANUALLY_ACCEPTED.value, 0),
            created_at=str(row["created_at"]),
            updated_at=str(row["updated_at"]),
            completed_at=str(row["completed_at"]) if row["completed_at"] else None,
        )
