from __future__ import annotations

import uuid
from pathlib import Path

from dataset_studio.core.sqlite import transaction
from dataset_studio.core.time import utc_now_iso
from dataset_studio.modules.jobs.models import JobItemStatus, JobStatus


class JobCreationRepository:
    """Creates an immutable job snapshot and its initial item queue."""

    def __init__(self, database_path: Path) -> None:
        self._database_path = database_path

    def insert_job(
        self,
        *,
        job_id: str,
        kind: str,
        configuration_snapshot: str,
        system_preset_id: str,
        system_prompt_snapshot: str,
        provider_profile_id: str,
        provider_snapshot: str,
        user_prompt_snapshot: str,
        json_fields_snapshot: str,
        scope: str,
        overwrite_existing: bool,
        retry_limit: int,
        asset_ids: list[str],
    ) -> None:
        now = utc_now_iso()
        with transaction(self._database_path) as connection:
            connection.execute(
                """
                INSERT INTO jobs (
                    id, status, kind, configuration_snapshot,
                    system_preset_id, system_prompt_snapshot,
                    provider_profile_id, provider_snapshot, user_prompt_snapshot,
                    json_fields_snapshot, scope, overwrite_existing, retry_limit, stop_requested,
                    created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
                """,
                (
                    job_id,
                    JobStatus.QUEUED.value,
                    kind,
                    configuration_snapshot,
                    system_preset_id,
                    system_prompt_snapshot,
                    provider_profile_id,
                    provider_snapshot,
                    user_prompt_snapshot,
                    json_fields_snapshot,
                    scope,
                    int(overwrite_existing),
                    retry_limit,
                    now,
                    now,
                ),
            )
            connection.executemany(
                """
                INSERT INTO job_items (
                    id, job_id, asset_id, status, attempt_count,
                    manually_accepted, created_at, updated_at
                ) VALUES (?, ?, ?, ?, 0, 0, ?, ?)
                """,
                [
                    (
                        str(uuid.uuid4()),
                        job_id,
                        asset_id,
                        JobItemStatus.PENDING.value,
                        now,
                        now,
                    )
                    for asset_id in asset_ids
                ],
            )
