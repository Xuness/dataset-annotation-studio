from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

from dataset_studio.core.sqlite import connect
from dataset_studio.modules.jobs.execution_snapshot import load_execution_snapshot
from dataset_studio.modules.jobs.models import (
    ExecutionBackend,
    JobAttempt,
    JobDetail,
    JobItemDetail,
    JobItemStatus,
    JobSummary,
)
from dataset_studio.modules.providers.config import ProviderExecutionProfile
from dataset_studio.modules.taggers.models import TaggerExecutionProfile


@dataclass(frozen=True, slots=True)
class FailedResponseCandidate:
    asset_id: str
    content: str
    source_hash: str | None
    output_base_revision_id: str | None


class JobQueryRepository:
    """Read-only job projections for the API and review interface."""

    def __init__(self, database_path: Path) -> None:
        self._database_path = database_path

    def list_jobs(
        self,
        *,
        offset: int = 0,
        limit: int = 100,
        active_only: bool = False,
    ) -> list[JobSummary]:
        connection = connect(self._database_path)
        try:
            where = "WHERE status IN ('queued', 'running', 'stopping')" if active_only else ""
            rows = connection.execute(
                f"""
                SELECT * FROM jobs
                {where}
                ORDER BY created_at DESC
                LIMIT ? OFFSET ?
                """,
                (limit, offset),
            ).fetchall()
            counts_by_job = self._counts_for_jobs(connection, [str(row["id"]) for row in rows])
            return [
                self._summary(connection, row, counts=counts_by_job.get(str(row["id"]), {}))
                for row in rows
            ]
        finally:
            connection.close()

    def get_job(
        self,
        job_id: str,
        *,
        include_items: bool = True,
        failed_items_only: bool = False,
        item_offset: int = 0,
        item_limit: int | None = None,
    ) -> JobDetail | None:
        connection = connect(self._database_path)
        try:
            row = connection.execute("SELECT * FROM jobs WHERE id = ?", (job_id,)).fetchone()
            if row is None:
                return None
            summary = self._summary(connection, row)
            items = (
                self._items(
                    connection,
                    job_id,
                    failed_only=failed_items_only,
                    offset=item_offset,
                    limit=item_limit,
                )
                if include_items
                else []
            )
            return JobDetail(**summary.model_dump(), items=items)
        finally:
            connection.close()

    def latest_failed_response(self, job_id: str, item_id: str) -> FailedResponseCandidate | None:
        connection = connect(self._database_path)
        try:
            row = connection.execute(
                """
                SELECT ji.asset_id, ji.output_base_revision_id,
                       ja.response_content, ja.source_annotation_hash
                FROM job_items ji
                JOIN job_attempts ja ON ja.job_item_id = ji.id
                WHERE ji.job_id = ?
                  AND ji.id = ?
                  AND ji.status = 'failed'
                  AND ja.status = 'validation_failed'
                  AND ja.response_content IS NOT NULL
                ORDER BY ja.started_at DESC, ja.rowid DESC
                LIMIT 1
                """,
                (job_id, item_id),
            ).fetchone()
            if row is None:
                return None
            return FailedResponseCandidate(
                asset_id=str(row["asset_id"]),
                content=str(row["response_content"]),
                source_hash=(
                    str(row["source_annotation_hash"]) if row["source_annotation_hash"] else None
                ),
                output_base_revision_id=(
                    str(row["output_base_revision_id"]) if row["output_base_revision_id"] else None
                ),
            )
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
    def _items(
        connection,
        job_id: str,
        *,
        failed_only: bool = False,
        offset: int = 0,
        limit: int | None = None,
    ) -> list[JobItemDetail]:
        status_clause = "AND ji.status = 'failed'" if failed_only else ""
        limit_clause = "LIMIT ? OFFSET ?" if limit is not None else ""
        parameters: list[object] = [job_id]
        if limit is not None:
            parameters.extend((limit, offset))
        item_rows = connection.execute(
            f"""
            SELECT ji.*, a.relative_path
            FROM job_items ji
            JOIN assets a ON a.id = ji.asset_id
            WHERE ji.job_id = ?
              {status_clause}
            ORDER BY a.relative_path COLLATE NOCASE
            {limit_clause}
            """,
            parameters,
        ).fetchall()
        if not item_rows:
            return []
        item_ids = [str(row["id"]) for row in item_rows]
        attempts_by_item: dict[str, list[JobAttempt]] = {item_id: [] for item_id in item_ids}
        for start in range(0, len(item_ids), 500):
            batch = item_ids[start : start + 500]
            placeholders = ",".join("?" for _ in batch)
            attempt_rows = connection.execute(
                f"""
                SELECT id, job_item_id, attempt_number, status, response_content, error_message,
                       started_at, finished_at, input_tokens, output_tokens,
                       cache_read_tokens, cache_write_tokens, reasoning_tokens, finish_reason
                FROM job_attempts
                WHERE job_item_id IN ({placeholders})
                ORDER BY job_item_id, attempt_number, started_at
                """,
                batch,
            ).fetchall()
            for attempt in attempt_rows:
                attempts_by_item[str(attempt["job_item_id"])].append(
                    JobAttempt.model_validate(dict(attempt))
                )
        items: list[JobItemDetail] = []
        for item_row in item_rows:
            values = dict(item_row)
            values["manually_accepted"] = bool(item_row["manually_accepted"])
            attempts = attempts_by_item[str(item_row["id"])]
            values["attempt_count"] = len(attempts)
            items.append(
                JobItemDetail(
                    **values,
                    attempts=attempts,
                )
            )
        return items

    @staticmethod
    def _summary(connection, row, *, counts: dict[str, int] | None = None) -> JobSummary:
        if counts is None:
            counts = {
                str(count_row["status"]): int(count_row["count"])
                for count_row in connection.execute(
                    """
                    SELECT status, COUNT(*) AS count
                    FROM job_items
                    WHERE job_id = ?
                    GROUP BY status
                    """,
                    (row["id"],),
                )
            }
        backend = ExecutionBackend(str(row["execution_backend"] or "provider"))
        execution = load_execution_snapshot(
            backend,
            row["execution_snapshot"],
            legacy_provider_snapshot=str(row["provider_snapshot"]),
        )
        system = json.loads(str(row["system_prompt_snapshot"]))
        configuration = json.loads(str(row["configuration_snapshot"]))
        kind = str(row["kind"])
        if isinstance(execution, TaggerExecutionProfile):
            execution_profile_name = execution.name
            model = execution.model_label
            system_preset_id = None
            system_preset_name = None
            provider_profile_id = None
            provider_profile_name = None
        else:
            assert isinstance(execution, ProviderExecutionProfile)
            execution_profile_name = execution.name
            model = execution.model_id
            system_preset_id = str(row["system_preset_id"])
            system_preset_name = str(system.get("name", "未命名预设"))
            provider_profile_id = str(row["provider_profile_id"])
            provider_profile_name = execution.name
        return JobSummary(
            id=str(row["id"]),
            status=str(row["status"]),
            kind=kind,
            execution_backend=backend,
            execution_profile_id=str(row["execution_profile_id"] or execution.id),
            execution_profile_name=execution_profile_name,
            system_preset_id=system_preset_id,
            system_preset_name=system_preset_name,
            provider_profile_id=provider_profile_id,
            provider_profile_name=provider_profile_name,
            model=model,
            scope=str(row["scope"]),
            overwrite_existing=bool(row["overwrite_existing"]),
            output_channel=str(row["output_channel"]),
            use_tags_as_context=bool(row["use_tags_as_context"]),
            target_language=(
                str(configuration["target_language"])
                if kind == "translation" and configuration.get("target_language")
                else None
            ),
            translation_policy=(
                str(configuration["translation_policy"])
                if kind == "translation" and configuration.get("translation_policy")
                else None
            ),
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

    @staticmethod
    def _counts_for_jobs(connection, job_ids: list[str]) -> dict[str, dict[str, int]]:
        if not job_ids:
            return {}
        placeholders = ",".join("?" for _ in job_ids)
        rows = connection.execute(
            f"""
            SELECT job_id, status, COUNT(*) AS count
            FROM job_items
            WHERE job_id IN ({placeholders})
            GROUP BY job_id, status
            """,
            job_ids,
        ).fetchall()
        counts: dict[str, dict[str, int]] = {job_id: {} for job_id in job_ids}
        for row in rows:
            counts[str(row["job_id"])][str(row["status"])] = int(row["count"])
        return counts
