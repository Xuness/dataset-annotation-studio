from __future__ import annotations

import asyncio
import json
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

from dataset_studio.core.errors import ResourceConflictError
from dataset_studio.core.files import atomic_write_text
from dataset_studio.modules.annotations.models import AnnotationChannel, AnnotationTag
from dataset_studio.modules.annotations.service import AnnotationService
from dataset_studio.modules.annotations.tag_balance import validate_tag_balance
from dataset_studio.modules.assets.service import AssetService
from dataset_studio.modules.jobs.execution_repository import JobExecutionRepository
from dataset_studio.modules.jobs.execution_snapshot import load_execution_snapshot
from dataset_studio.modules.jobs.models import ExecutionBackend, JobItemStatus, JobKind
from dataset_studio.modules.jobs.provider_call import JobStopped, complete_until_stopped
from dataset_studio.modules.presets.service import PresetService
from dataset_studio.modules.prompts.composer import compose_user_prompt
from dataset_studio.modules.providers.base import ModelProvider
from dataset_studio.modules.providers.config import (
    CodexModelOptions,
    OpenAICompatibleModelOptions,
    OpenCodeGoModelOptions,
    OpenRouterModelOptions,
    ProviderExecutionProfile,
    ProviderType,
)
from dataset_studio.modules.providers.models import (
    MultimodalRequest,
    ProviderRequestError,
    ProviderResponse,
)
from dataset_studio.modules.translations.identity import (
    TranslationProducerKind,
    TranslationSourceKind,
)
from dataset_studio.modules.translations.prompt import translation_user_prompt
from dataset_studio.modules.translations.service import (
    TranslationService,
    TranslationSourceChangedError,
)
from dataset_studio.modules.translations.validation import (
    parse_tag_translation_response,
    validate_translation_structure,
)


class ProviderExecutorContainer(Protocol):
    presets: PresetService
    translations: TranslationService
    assets: AssetService
    annotations: AnnotationService


@dataclass(frozen=True, slots=True)
class ProviderItemContext:
    project_id: str
    job_id: str
    item_id: str
    asset_id: str
    kind: JobKind
    output_channel: AnnotationChannel
    profile: ProviderExecutionProfile
    credential: str | None
    request: MultimodalRequest
    expected_output_revision_id: str | None
    overwrite_existing: bool
    translation_configuration: dict[str, object]
    source_content: str | None
    source_hash: str | None
    source_tags: list[AnnotationTag]
    translation_source_kind: TranslationSourceKind | None
    translation_producer_kind: TranslationProducerKind | None
    tag_revision_id: str | None


class ProviderJobExecutor:
    def __init__(
        self,
        container: ProviderExecutorContainer,
        provider_factory: Callable[[ProviderType], ModelProvider],
    ) -> None:
        self._container = container
        self._provider_factory = provider_factory

    async def process_item(
        self,
        project_id: str,
        workspace_root: Path,
        runs_root: Path,
        job: dict[str, object],
        item: dict[str, object],
        repository: JobExecutionRepository,
    ) -> None:
        context = self._prepare_context(project_id, job, item, repository)
        if context is None:
            return
        provider = self._provider_factory(context.profile.provider_type)
        max_attempts = int(job["retry_limit"]) + 1
        previous_attempts = int(item["attempt_count"])
        last_error = "请求未完成。"

        for cycle_attempt in range(previous_attempts + 1, max_attempts + 1):
            if repository.is_stop_requested(context.job_id):
                repository.finish_item(context.item_id, JobItemStatus.INTERRUPTED)
                return
            attempt_id, attempt_number = repository.start_attempt(
                context.item_id,
                source_annotation_hash=context.source_hash,
            )
            payload_path = self._save_request_payload(
                workspace_root,
                runs_root,
                context,
                attempt_number,
            )
            response: ProviderResponse | None = None
            try:
                response = await complete_until_stopped(
                    provider,
                    context.profile,
                    context.credential,
                    context.request,
                    lambda: repository.is_stop_requested(context.job_id),
                )
                payload_path = self._save_response_payload(
                    workspace_root,
                    runs_root,
                    context,
                    attempt_number,
                    response,
                )
                valid, validation_status, validation_error = self._validate_response(
                    context,
                    response.content,
                )
                if not valid:
                    last_error = validation_error or "响应内容校验失败。"
                    self._finish_response_attempt(
                        repository,
                        attempt_id,
                        status="validation_failed",
                        response=response,
                        payload_path=payload_path,
                        error=last_error,
                    )
                elif not self._apply_response(context, response.content, repository):
                    self._finish_response_attempt(
                        repository,
                        attempt_id,
                        status="skipped_existing",
                        response=response,
                        payload_path=payload_path,
                    )
                    repository.finish_item(context.item_id, JobItemStatus.SKIPPED)
                    return
                else:
                    self._finish_response_attempt(
                        repository,
                        attempt_id,
                        status="succeeded",
                        response=response,
                        payload_path=payload_path,
                    )
                    repository.finish_item(
                        context.item_id,
                        JobItemStatus.SUCCEEDED,
                        validation_status=validation_status,
                    )
                    return
            except TranslationSourceChangedError as error:
                last_error = str(error)
                self._finish_response_attempt(
                    repository,
                    attempt_id,
                    status="source_changed",
                    response=response,
                    payload_path=payload_path,
                    error=last_error,
                )
                repository.finish_item(
                    context.item_id,
                    JobItemStatus.FAILED,
                    error=last_error,
                    validation_status="source_changed",
                )
                return
            except ResourceConflictError as error:
                last_error = str(error)
                self._finish_response_attempt(
                    repository,
                    attempt_id,
                    status="output_changed",
                    response=response,
                    payload_path=payload_path,
                    error=last_error,
                )
                repository.finish_item(
                    context.item_id,
                    JobItemStatus.FAILED,
                    error=last_error,
                    validation_status="output_changed",
                )
                return
            except JobStopped:
                repository.finish_attempt(
                    attempt_id,
                    status="interrupted",
                    error_message="任务已由用户停止。",
                    provider_payload_path=payload_path,
                )
                repository.finish_item(context.item_id, JobItemStatus.INTERRUPTED)
                return
            except ProviderRequestError as error:
                last_error = str(error)
                payload_path = self._save_error_payload(
                    workspace_root,
                    runs_root,
                    context,
                    attempt_number,
                    error,
                )
                repository.finish_attempt(
                    attempt_id,
                    status="request_failed",
                    response_content=error.response_text,
                    error_message=last_error,
                    provider_payload_path=payload_path,
                )
            except asyncio.CancelledError:
                repository.finish_attempt(
                    attempt_id,
                    status="interrupted",
                    error_message="应用关闭或任务被停止。",
                    provider_payload_path=payload_path,
                )
                repository.finish_item(context.item_id, JobItemStatus.INTERRUPTED)
                raise
            except Exception as error:
                last_error = str(error)
                repository.finish_attempt(
                    attempt_id,
                    status="internal_error",
                    error_message=last_error,
                    provider_payload_path=payload_path,
                )

            if cycle_attempt < max_attempts:
                delay = min(2 ** (cycle_attempt - 1), 8)
                for _ in range(delay * 2):
                    if repository.is_stop_requested(context.job_id):
                        repository.finish_item(context.item_id, JobItemStatus.INTERRUPTED)
                        return
                    await asyncio.sleep(0.5)

        repository.finish_item(
            context.item_id,
            JobItemStatus.FAILED,
            error=last_error,
            validation_status="failed",
        )

    def _prepare_context(
        self,
        project_id: str,
        job: dict[str, object],
        item: dict[str, object],
        repository: JobExecutionRepository,
    ) -> ProviderItemContext | None:
        job_id = str(job["id"])
        item_id = str(item["id"])
        asset_id = str(item["asset_id"])
        if repository.is_stop_requested(job_id):
            repository.finish_item(item_id, JobItemStatus.INTERRUPTED)
            return None

        backend = ExecutionBackend(str(job.get("execution_backend") or "provider"))
        execution_profile = load_execution_snapshot(
            backend,
            job.get("execution_snapshot"),
            legacy_provider_snapshot=str(job["provider_snapshot"]),
        )
        if not isinstance(execution_profile, ProviderExecutionProfile):
            raise ValueError("本地 Tagger 项目被错误地交给了供应商执行器。")
        kind = JobKind(str(job["kind"]))
        output_channel = AnnotationChannel(str(job["output_channel"]))
        overwrite_existing = bool(job["overwrite_existing"])
        if (
            kind == JobKind.ANNOTATION
            and not overwrite_existing
            and self._container.annotations.get_channel(
                project_id,
                asset_id,
                output_channel,
            ).exists
        ):
            repository.finish_item(item_id, JobItemStatus.SKIPPED)
            return None
        try:
            credential = self._container.presets.get_provider_credential(execution_profile)
        except ValueError as error:
            repository.finish_item(item_id, JobItemStatus.FAILED, error=str(error))
            return None

        system_snapshot = json.loads(str(job["system_prompt_snapshot"]))
        source_content: str | None = None
        source_hash: str | None = None
        source_tags: list[AnnotationTag] = []
        translation_source_kind: TranslationSourceKind | None = None
        translation_producer_kind: TranslationProducerKind | None = None
        tag_revision_id: str | None = None
        translation_configuration: dict[str, object] = {}
        if kind == JobKind.TRANSLATION:
            translation_configuration = json.loads(str(job["configuration_snapshot"]))
            language = str(translation_configuration["target_language"])
            policy = str(translation_configuration["translation_policy"])
            translation_source_kind = TranslationSourceKind(
                str(translation_configuration.get("translation_source_kind", "description"))
            )
            translation_producer_kind = TranslationProducerKind(
                str(translation_configuration.get("translation_producer_kind", "llm"))
            )
            source = self._container.translations.read_source_revision(
                project_id,
                asset_id,
                translation_source_kind,
            )
            if source is None:
                repository.finish_item(
                    item_id,
                    JobItemStatus.FAILED,
                    error="源标注已不存在，无法翻译。",
                    validation_status="source_missing",
                )
                return None
            if not self._container.translations.should_translate(
                project_id,
                asset_id,
                language,
                policy,
                source_kind=translation_source_kind,
                producer_kind=translation_producer_kind,
            ):
                repository.finish_item(item_id, JobItemStatus.SKIPPED)
                return None
            source_content = source.content
            source_hash = source.content_hash
            source_tags = source.tags
            image_path = None
            user_prompt = translation_user_prompt(
                language,
                source_content,
                source_kind=translation_source_kind,
                tags=source_tags,
            )
        else:
            image_path = self._container.assets.image_path(project_id, asset_id)
            metadata = self._container.assets.metadata(project_id, asset_id)
            selected_fields = json.loads(str(job["json_fields_snapshot"]))
            tag_revision_id = (
                repository.annotation_input_revision(item_id, "tag_context")
                if bool(job["use_tags_as_context"])
                else None
            )
            auxiliary_tags = (
                [
                    tag.name
                    for tag in self._container.annotations.revision_tags(
                        project_id,
                        tag_revision_id,
                    )
                ]
                if tag_revision_id
                else []
            )
            user_prompt = compose_user_prompt(
                str(job["user_prompt_snapshot"]),
                metadata.value if metadata.exists and not metadata.error else None,
                selected_fields,
                auxiliary_tags,
            )
        return ProviderItemContext(
            project_id=project_id,
            job_id=job_id,
            item_id=item_id,
            asset_id=asset_id,
            kind=kind,
            output_channel=output_channel,
            profile=execution_profile,
            credential=credential,
            request=MultimodalRequest(
                image_path=image_path,
                system_prompt=str(system_snapshot["system_prompt"]),
                user_prompt=user_prompt,
            ),
            expected_output_revision_id=(
                str(item["output_base_revision_id"])
                if item.get("output_base_revision_id")
                else None
            ),
            overwrite_existing=overwrite_existing,
            translation_configuration=translation_configuration,
            source_content=source_content,
            source_hash=source_hash,
            source_tags=source_tags,
            translation_source_kind=translation_source_kind,
            translation_producer_kind=translation_producer_kind,
            tag_revision_id=tag_revision_id,
        )

    @staticmethod
    def _validate_response(
        context: ProviderItemContext,
        content: str,
    ) -> tuple[bool, str, str | None]:
        if context.kind == JobKind.TRANSLATION:
            assert context.source_content is not None
            if context.translation_source_kind == TranslationSourceKind.TAGS:
                valid, status, _ = parse_tag_translation_response(
                    content,
                    context.source_tags,
                )
                return valid, status, None if valid else status
            valid, status = validate_translation_structure(context.source_content, content)
            return valid, status, None if valid else status
        validation = validate_tag_balance(content)
        return (
            validation.valid,
            validation.status.value,
            None if validation.valid else validation.issues[0].message,
        )

    def _apply_response(
        self,
        context: ProviderItemContext,
        content: str,
        repository: JobExecutionRepository,
    ) -> bool:
        if context.kind == JobKind.TRANSLATION:
            language = str(context.translation_configuration["target_language"])
            policy = str(context.translation_configuration["translation_policy"])
            assert context.translation_source_kind is not None
            assert context.translation_producer_kind is not None
            if not self._container.translations.should_translate(
                context.project_id,
                context.asset_id,
                language,
                policy,
                source_kind=context.translation_source_kind,
                producer_kind=context.translation_producer_kind,
            ):
                return False
            assert context.source_hash is not None
            self._container.translations.save_generated(
                context.project_id,
                context.asset_id,
                language,
                content,
                expected_source_hash=context.source_hash,
                source_kind=context.translation_source_kind,
                producer_kind=context.translation_producer_kind,
                provider_profile_id=context.profile.id,
                provider_profile_name=context.profile.name,
                model=context.profile.model_id,
                expected_modified_at=context.expected_output_revision_id,
                lease_owner_id=context.item_id,
                source_job_item_id=context.item_id,
            )
            return True
        if (
            self._container.annotations.get_channel(
                context.project_id,
                context.asset_id,
                context.output_channel,
            ).exists
            and not context.overwrite_existing
        ):
            return False
        self._container.annotations.save_generated(
            context.project_id,
            context.asset_id,
            content,
            channel=context.output_channel,
            expected_modified_at=context.expected_output_revision_id,
            lease_owner_id=context.item_id,
            source_job_item_id=context.item_id,
            input_revisions=(
                ((context.tag_revision_id, "tag_context"),) if context.tag_revision_id else ()
            ),
        )
        return True

    @staticmethod
    def _finish_response_attempt(
        repository: JobExecutionRepository,
        attempt_id: str,
        *,
        status: str,
        response: ProviderResponse | None,
        payload_path: str,
        error: str | None = None,
    ) -> None:
        repository.finish_attempt(
            attempt_id,
            status=status,
            response_content=response.content if response else None,
            error_message=error,
            provider_payload_path=payload_path,
            input_tokens=response.input_tokens if response else None,
            output_tokens=response.output_tokens if response else None,
            cache_read_tokens=response.cache_read_tokens if response else None,
            cache_write_tokens=response.cache_write_tokens if response else None,
            reasoning_tokens=response.reasoning_tokens if response else None,
            finish_reason=response.finish_reason if response else None,
        )

    @staticmethod
    def _save_request_payload(
        workspace_root: Path,
        runs_root: Path,
        context: ProviderItemContext,
        attempt_number: int,
    ) -> str:
        path = runs_root / context.job_id / context.asset_id / f"attempt-{attempt_number}.json"
        payload = {
            "artifact_version": 2,
            "kind": "request",
            "request": ProviderJobExecutor._request_snapshot(
                context.profile,
                context.request,
            ),
        }
        atomic_write_text(path, json.dumps(payload, ensure_ascii=False, indent=2) + "\n")
        return path.relative_to(workspace_root).as_posix()

    @staticmethod
    def _save_response_payload(
        workspace_root: Path,
        runs_root: Path,
        context: ProviderItemContext,
        attempt_number: int,
        response: ProviderResponse,
    ) -> str:
        path = runs_root / context.job_id / context.asset_id / f"attempt-{attempt_number}.json"
        payload = {
            "artifact_version": 2,
            "kind": "response",
            "request": ProviderJobExecutor._request_snapshot(
                context.profile,
                context.request,
            ),
            "content": response.content,
            "reasoning_content": response.reasoning_content,
            "finish_reason": response.finish_reason,
            "input_tokens": response.input_tokens,
            "output_tokens": response.output_tokens,
            "cache_read_tokens": response.cache_read_tokens,
            "cache_write_tokens": response.cache_write_tokens,
            "reasoning_tokens": response.reasoning_tokens,
            "raw": response.raw_payload,
        }
        atomic_write_text(path, json.dumps(payload, ensure_ascii=False, indent=2) + "\n")
        return path.relative_to(workspace_root).as_posix()

    @staticmethod
    def _save_error_payload(
        workspace_root: Path,
        runs_root: Path,
        context: ProviderItemContext,
        attempt_number: int,
        error: ProviderRequestError,
    ) -> str:
        path = runs_root / context.job_id / context.asset_id / f"attempt-{attempt_number}.json"
        payload = {
            "artifact_version": 2,
            "kind": "error",
            "request": ProviderJobExecutor._request_snapshot(
                context.profile,
                context.request,
            ),
            "error": str(error),
            "status_code": error.status_code,
            "response": error.response_text,
        }
        atomic_write_text(path, json.dumps(payload, ensure_ascii=False, indent=2) + "\n")
        return path.relative_to(workspace_root).as_posix()

    @staticmethod
    def _request_snapshot(
        profile: ProviderExecutionProfile,
        request: MultimodalRequest,
    ) -> dict[str, object]:
        model = profile.model
        options = model.protocol_options
        reasoning_effort = (
            options.reasoning_effort.value
            if isinstance(
                options,
                (
                    OpenRouterModelOptions,
                    OpenAICompatibleModelOptions,
                    OpenCodeGoModelOptions,
                    CodexModelOptions,
                ),
            )
            and options.reasoning_effort
            else None
        )
        return {
            "system_prompt": request.system_prompt,
            "user_prompt": request.user_prompt,
            "image_filename": request.image_path.name if request.image_path else None,
            "parameters": {
                "provider_type": profile.provider_type.value,
                "provider_profile_name": profile.name,
                "model": model.model_id,
                "temperature": model.temperature,
                "max_output_tokens": model.max_output_tokens,
                "timeout_seconds": model.timeout_seconds,
                "top_p": model.top_p,
                "seed": model.seed,
                "service_tier": (
                    options.service_tier.value
                    if isinstance(options, OpenRouterModelOptions) and options.service_tier
                    else None
                ),
                "reasoning_effort": reasoning_effort,
                "prompt_cache_strategy": (
                    options.prompt_cache_strategy.value if options.prompt_cache_strategy else None
                )
                if isinstance(options, OpenRouterModelOptions)
                else None,
            },
        }
