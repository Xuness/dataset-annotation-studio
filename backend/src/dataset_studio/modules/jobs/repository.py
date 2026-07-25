from __future__ import annotations

import json
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
        use_tags_as_context: bool,
        output_language: str = "",
        output_translation_source_kind: str = "",
        output_translation_producer_kind: str = "",
        retry_limit: int,
        asset_ids: list[str],
    ) -> None:
        if output_channel == "translation" and (
            not output_translation_source_kind or not output_translation_producer_kind
        ):
            try:
                translation_configuration = json.loads(configuration_snapshot)
            except json.JSONDecodeError:
                translation_configuration = {}
            output_translation_source_kind = output_translation_source_kind or str(
                translation_configuration.get("translation_source_kind", "description")
            )
            output_translation_producer_kind = output_translation_producer_kind or str(
                translation_configuration.get("translation_producer_kind", "llm")
            )
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
                    output_channel, use_tags_as_context, created_at, updated_at
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
                    int(use_tags_as_context),
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
                      AND translation_source_kind = ?
                      AND translation_producer_kind = ?
                    """,
                    (
                        asset_id,
                        output_channel,
                        output_language,
                        output_translation_source_kind,
                        output_translation_producer_kind,
                    ),
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
                if use_tags_as_context:
                    tag_document = connection.execute(
                        """
                        SELECT d.head_revision_id
                        FROM annotation_documents d
                        JOIN annotation_document_revisions r
                          ON r.id = d.head_revision_id
                        JOIN assets a ON a.id = d.asset_id
                        WHERE d.asset_id = ?
                          AND d.channel = 'tags'
                          AND d.language = ''
                          AND r.is_tombstone = 0
                          AND r.image_content_hash = a.content_hash
                          AND r.validation_status NOT IN (
                              'invalid', 'encoding_error', 'empty', 'unchecked'
                          )
                        """,
                        (asset_id,),
                    ).fetchone()
                    if tag_document and tag_document["head_revision_id"]:
                        connection.execute(
                            """
                            INSERT INTO job_item_annotation_inputs (
                                job_item_id, revision_id, role
                            ) VALUES (?, ?, 'tag_context')
                            """,
                            (item_id, str(tag_document["head_revision_id"])),
                        )
