from __future__ import annotations

import json
from typing import Protocol

from dataset_studio.core.errors import ResourceConflictError
from dataset_studio.modules.jobs.execution_repository import JobExecutionRepository
from dataset_studio.modules.jobs.models import JobItemStatus
from dataset_studio.modules.tag_dictionaries.service import TagDictionaryService
from dataset_studio.modules.translations.identity import (
    TranslationProducerKind,
    TranslationSourceKind,
)
from dataset_studio.modules.translations.service import (
    TranslationService,
    TranslationSourceChangedError,
)


class LocalDictionaryExecutorContainer(Protocol):
    translations: TranslationService
    tag_dictionaries: TagDictionaryService


class LocalDictionaryJobExecutor:
    def __init__(self, container: LocalDictionaryExecutorContainer) -> None:
        self._container = container

    async def process_item(
        self,
        project_id: str,
        job: dict[str, object],
        item: dict[str, object],
        repository: JobExecutionRepository,
    ) -> None:
        job_id = str(job["id"])
        item_id = str(item["id"])
        asset_id = str(item["asset_id"])
        if repository.is_stop_requested(job_id):
            repository.finish_item(item_id, JobItemStatus.INTERRUPTED)
            return

        configuration = json.loads(str(job["configuration_snapshot"]))
        language = str(configuration["target_language"])
        policy = str(configuration["translation_policy"])
        source_kind = TranslationSourceKind(
            str(configuration.get("translation_source_kind", "tags"))
        )
        producer_kind = TranslationProducerKind(
            str(configuration.get("translation_producer_kind", "local_dictionary"))
        )
        if source_kind != TranslationSourceKind.TAGS:
            raise ValueError("本地词典任务的源类型必须是 Tags。")
        if producer_kind != TranslationProducerKind.LOCAL_DICTIONARY:
            raise ValueError("本地词典任务的译文生产者类型无效。")

        source = self._container.translations.read_source_revision(
            project_id,
            asset_id,
            source_kind,
        )
        if source is None:
            repository.finish_item(
                item_id,
                JobItemStatus.FAILED,
                error="源 Tags 已不存在，无法生成本地词典译文。",
                validation_status="source_missing",
            )
            return
        if not self._container.translations.should_translate(
            project_id,
            asset_id,
            language,
            policy,
            source_kind=source_kind,
            producer_kind=producer_kind,
        ):
            repository.finish_item(item_id, JobItemStatus.SKIPPED)
            return

        attempt_id, _ = repository.start_attempt(
            item_id,
            source_annotation_hash=source.content_hash,
        )
        try:
            resolution = self._container.tag_dictionaries.resolve(
                [tag.name for tag in source.tags],
                language,
                categories=[tag.category for tag in source.tags],
            )
            content = "\n".join(
                entry.translation or entry.requested_tag for entry in resolution.entries
            )
            if repository.is_stop_requested(job_id):
                repository.finish_attempt(
                    attempt_id,
                    status="interrupted",
                    error_message="任务已由用户停止。",
                )
                repository.finish_item(item_id, JobItemStatus.INTERRUPTED)
                return
            self._container.translations.save_generated(
                project_id,
                asset_id,
                language,
                content,
                expected_source_hash=source.content_hash,
                source_kind=source_kind,
                producer_kind=producer_kind,
                expected_modified_at=(
                    str(item["output_base_revision_id"])
                    if item.get("output_base_revision_id")
                    else None
                ),
                lease_owner_id=item_id,
                source_job_item_id=item_id,
                content_is_normalized=True,
                producer_metadata={
                    "dictionary_resolution_hash": resolution.resolution_hash,
                    "dictionary_unmatched_count": resolution.unmatched_count,
                    "dictionary_entries": [
                        entry.model_dump(mode="json") for entry in resolution.entries
                    ],
                    "dictionary_execution_snapshot": json.loads(str(job["execution_snapshot"])),
                },
            )
            repository.finish_attempt(
                attempt_id,
                status="succeeded",
                response_content=content,
                finish_reason="local_dictionary",
            )
            repository.finish_item(
                item_id,
                JobItemStatus.SUCCEEDED,
                validation_status="aligned",
            )
        except TranslationSourceChangedError as error:
            self._finish_failure(
                repository,
                attempt_id,
                item_id,
                status="source_changed",
                validation_status="source_changed",
                error=error,
            )
        except ResourceConflictError as error:
            self._finish_failure(
                repository,
                attempt_id,
                item_id,
                status="output_changed",
                validation_status="output_changed",
                error=error,
            )
        except Exception as error:
            self._finish_failure(
                repository,
                attempt_id,
                item_id,
                status="internal_error",
                validation_status="failed",
                error=error,
            )

    @staticmethod
    def _finish_failure(
        repository: JobExecutionRepository,
        attempt_id: str,
        item_id: str,
        *,
        status: str,
        validation_status: str,
        error: Exception,
    ) -> None:
        message = str(error) or type(error).__name__
        repository.finish_attempt(
            attempt_id,
            status=status,
            error_message=message,
        )
        repository.finish_item(
            item_id,
            JobItemStatus.FAILED,
            error=message,
            validation_status=validation_status,
        )
