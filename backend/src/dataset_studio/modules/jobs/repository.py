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
        execution_backend: str,
        execution_profile_id: str,
        execution_snapshot: str,
        system_preset_id: str,
        system_prompt_snapshot: str,
        provider_profile_id: str,
        provider_snapshot: str,
        user_prompt_snapshot: str,
        json_fields_snapshot: str,
        scope: str,
        overwrite_existing: bool,
        output_channel: str,
        use_confirmed_tags: bool,
        output_language: str = "",
        retry_limit: int,
        asset_ids: list[str],
    ) -> None:
        now = utc_now_iso()
        with transaction(self._database_path) as connection:
            connection.execute(
                """
                INSERT INTO jobs (
                    id, status, kind, configuration_snapshot,
                    execution_backend, execution_profile_id, execution_snapshot,
                    system_preset_id, system_prompt_snapshot,
                    provider_profile_id, provider_snapshot, user_prompt_snapshot,
                    json_fields_snapshot, scope, overwrite_existing, retry_limit, stop_requested,
                    output_channel, use_confirmed_tags, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)
                """,
                (
                    job_id,
                    JobStatus.QUEUED.value,
                    kind,
                    configuration_snapshot,
                    execution_backend,
                    execution_profile_id,
                    execution_snapshot,
                    system_preset_id,
                    system_prompt_snapshot,
                    provider_profile_id,
                    provider_snapshot,
                    user_prompt_snapshot,
                    json_fields_snapshot,
                    scope,
                    int(overwrite_existing),
                    retry_limit,
                    output_channel,
                    int(use_confirmed_tags),
                    now,
                    now,
                ),
            )
            for asset_id in asset_ids:
                item_id = str(uuid.uuid4())
                output_base = connection.execute(
                    """
                    SELECT head_revision_id
                    FROM annotation_documents
                    WHERE asset_id = ? AND channel = ? AND language = ?
                    """,
                    (asset_id, output_channel, output_language),
                ).fetchone()
                output_base_revision_id = (
                    str(output_base["head_revision_id"])
                    if output_base and output_base["head_revision_id"]
                    else None
                )
                connection.execute(
                    """
                    INSERT INTO job_items (
                        id, job_id, asset_id, status, attempt_count,
                        manually_accepted, output_base_revision_id,
                        created_at, updated_at
                    ) VALUES (?, ?, ?, ?, 0, 0, ?, ?, ?)
                    """,
                    (
                        item_id,
                        job_id,
                        asset_id,
                        JobItemStatus.PENDING.value,
                        output_base_revision_id,
                        now,
                        now,
                    ),
                )
                if use_confirmed_tags:
                    tag_document = connection.execute(
                        """
                        SELECT d.confirmed_revision_id
                        FROM annotation_documents d
                        JOIN annotation_document_revisions r
                          ON r.id = d.confirmed_revision_id
                        JOIN assets a ON a.id = d.asset_id
                        WHERE d.asset_id = ?
                          AND d.channel = 'tags'
                          AND d.language = ''
                          AND r.is_tombstone = 0
                          AND r.image_content_hash = a.content_hash
                        """,
                        (asset_id,),
                    ).fetchone()
                    if tag_document and tag_document["confirmed_revision_id"]:
                        connection.execute(
                            """
                            INSERT INTO job_item_annotation_inputs (
                                job_item_id, revision_id, role
                            ) VALUES (?, ?, 'tag_context')
                            """,
                            (item_id, str(tag_document["confirmed_revision_id"])),
                        )
