from __future__ import annotations

import json
from collections.abc import Callable, Sequence
from contextlib import suppress
from dataclasses import dataclass
from pathlib import Path

from dataset_studio.core.files import atomic_write_text
from dataset_studio.modules.annotations.service import (
    AnnotationService,
    GeneratedAnnotation,
)
from dataset_studio.modules.annotations.tag_balance import validate_tag_balance
from dataset_studio.modules.jobs.execution_repository import (
    AttemptCompletion,
    ItemCompletion,
    JobExecutionRepository,
)
from dataset_studio.modules.jobs.models import JobItemStatus
from dataset_studio.modules.taggers.models import (
    TaggerExecutionProfile,
    TaggerInferenceResult,
)
from dataset_studio.modules.taggers.pipeline import (
    TaggerPipelineOutcome,
    TaggerPipelineReport,
)


@dataclass(frozen=True, slots=True)
class StartedTaggerItem:
    item: dict[str, object]
    image_path: Path
    attempt_id: str
    attempt_number: int
    request: dict[str, object]

    @property
    def item_id(self) -> str:
        return str(self.item["id"])

    @property
    def asset_id(self) -> str:
        return str(self.item["asset_id"])


@dataclass(frozen=True, slots=True)
class _SuccessfulItem:
    started: StartedTaggerItem
    result: TaggerInferenceResult
    artifact_path: str
    validation_status: str


@dataclass(frozen=True, slots=True)
class _EvaluatedItem:
    started: StartedTaggerItem
    result: TaggerInferenceResult | None
    artifact_payload: dict[str, object]
    attempt_status: str | None
    item_status: JobItemStatus | None
    error: str | None
    validation_status: str | None


class LocalTaggerBatchCommitter:
    """Coordinates ordered artifacts, annotation writes, and job state commits."""

    def __init__(self, annotations: AnnotationService) -> None:
        self._annotations = annotations

    def commit(
        self,
        *,
        project_id: str,
        workspace_root: Path,
        runs_root: Path,
        job_id: str,
        overwrite_existing: bool,
        started: Sequence[StartedTaggerItem],
        report: TaggerPipelineReport,
        repository: JobExecutionRepository,
        should_stop: Callable[[], bool],
    ) -> None:
        outcome_by_id = {outcome.key: outcome for outcome in report.outcomes}
        evaluated = [
            self._evaluate_outcome(
                workspace_root,
                overwrite_existing,
                item,
                outcome_by_id[item.item_id],
                report,
            )
            for item in started
        ]
        artifact_paths = self._save_artifacts(
            workspace_root,
            runs_root,
            job_id,
            [(item.started, item.artifact_payload) for item in evaluated],
        )
        attempt_completions: list[AttemptCompletion] = []
        item_completions: list[ItemCompletion] = []
        successful: list[_SuccessfulItem] = []
        for item in evaluated:
            artifact_path = artifact_paths[item.started.item_id]
            if item.attempt_status is None:
                assert item.result is not None
                assert item.validation_status is not None
                successful.append(
                    _SuccessfulItem(
                        started=item.started,
                        result=item.result,
                        artifact_path=artifact_path,
                        validation_status=item.validation_status,
                    )
                )
                continue
            assert item.item_status is not None
            attempt_completions.append(
                AttemptCompletion(
                    attempt_id=item.started.attempt_id,
                    status=item.attempt_status,
                    response_content=item.result.content if item.result else None,
                    error_message=item.error,
                    provider_payload_path=artifact_path,
                    finish_reason="local_inference" if item.result else None,
                )
            )
            item_completions.append(
                ItemCompletion(
                    item_id=item.started.item_id,
                    status=item.item_status,
                    error=item.error,
                    validation_status=item.validation_status,
                )
            )

        if should_stop():
            message = "任务已由用户停止；本批推理结果未写入。"
            for item in successful:
                attempt_completions.append(
                    AttemptCompletion(
                        attempt_id=item.started.attempt_id,
                        status="interrupted",
                        response_content=item.result.content,
                        error_message=message,
                        provider_payload_path=item.artifact_path,
                        finish_reason="local_inference",
                    )
                )
                item_completions.append(
                    ItemCompletion(
                        item_id=item.started.item_id,
                        status=JobItemStatus.INTERRUPTED,
                    )
                )
            repository.finish_batch(attempt_completions, item_completions)
            return

        committed, failed = self._save_annotations(project_id, successful)
        for item in committed:
            attempt_completions.append(
                AttemptCompletion(
                    attempt_id=item.started.attempt_id,
                    status="succeeded",
                    response_content=item.result.content,
                    provider_payload_path=item.artifact_path,
                    finish_reason="local_inference",
                )
            )
            item_completions.append(
                ItemCompletion(
                    item_id=item.started.item_id,
                    status=JobItemStatus.SUCCEEDED,
                    validation_status=item.validation_status,
                )
            )
        for item, error in failed:
            message = str(error) or type(error).__name__
            attempt_completions.append(
                AttemptCompletion(
                    attempt_id=item.started.attempt_id,
                    status="internal_error",
                    response_content=item.result.content,
                    error_message=message,
                    provider_payload_path=item.artifact_path,
                    finish_reason="local_inference",
                )
            )
            item_completions.append(
                ItemCompletion(
                    item_id=item.started.item_id,
                    status=JobItemStatus.FAILED,
                    error=message,
                    validation_status="write_failed",
                )
            )
        repository.finish_batch(attempt_completions, item_completions)

    def fail_started(
        self,
        repository: JobExecutionRepository,
        workspace_root: Path,
        runs_root: Path,
        job_id: str,
        started: Sequence[StartedTaggerItem],
        message: str,
    ) -> None:
        payloads = [
            (
                item,
                {
                    "artifact_version": 2,
                    "kind": "error",
                    "request": item.request,
                    "error": message,
                },
            )
            for item in started
        ]
        paths: dict[str, str] = {}
        with suppress(Exception):
            paths = self._save_artifacts(
                workspace_root,
                runs_root,
                job_id,
                payloads,
            )
        repository.finish_batch(
            [
                AttemptCompletion(
                    attempt_id=item.attempt_id,
                    status="inference_failed",
                    error_message=message,
                    provider_payload_path=paths.get(item.item_id),
                )
                for item in started
            ],
            [
                ItemCompletion(
                    item_id=item.item_id,
                    status=JobItemStatus.FAILED,
                    error=message,
                    validation_status="inference_failed",
                )
                for item in started
            ],
        )

    @staticmethod
    def interrupt_unstarted(
        repository: JobExecutionRepository,
        items: Sequence[dict[str, object]],
    ) -> None:
        repository.finish_batch(
            [],
            [
                ItemCompletion(
                    item_id=str(item["id"]),
                    status=JobItemStatus.INTERRUPTED,
                )
                for item in items
            ],
        )

    @staticmethod
    def interrupt_started(
        repository: JobExecutionRepository,
        started: Sequence[StartedTaggerItem],
        message: str,
    ) -> None:
        repository.finish_batch(
            [
                AttemptCompletion(
                    attempt_id=item.attempt_id,
                    status="interrupted",
                    error_message=message,
                )
                for item in started
            ],
            [
                ItemCompletion(
                    item_id=item.item_id,
                    status=JobItemStatus.INTERRUPTED,
                )
                for item in started
            ],
        )

    def _evaluate_outcome(
        self,
        workspace_root: Path,
        overwrite_existing: bool,
        started: StartedTaggerItem,
        outcome: TaggerPipelineOutcome,
        report: TaggerPipelineReport,
    ) -> _EvaluatedItem:
        if outcome.error is not None or outcome.result is None:
            message = outcome.error or "本地打标流水线没有生成结果。"
            return _EvaluatedItem(
                started=started,
                result=None,
                artifact_payload={
                    "artifact_version": 2,
                    "kind": "error",
                    "request": started.request,
                    "error": message,
                    "raw": {
                        "execution_provider": report.provider,
                        "requested_batch_size": report.requested_batch_size,
                        "effective_batch_size": report.effective_batch_size,
                    },
                },
                attempt_status="inference_failed",
                item_status=JobItemStatus.FAILED,
                error=message,
                validation_status="inference_failed",
            )

        result = outcome.result
        validation = validate_tag_balance(result.content)
        if not validation.valid:
            message = validation.issues[0].message
            return _EvaluatedItem(
                started=started,
                result=result,
                artifact_payload=self._response_payload(
                    started.request,
                    result,
                    report.effective_batch_size,
                    validation_error=message,
                ),
                attempt_status="validation_failed",
                item_status=JobItemStatus.FAILED,
                error=message,
                validation_status=validation.status.value,
            )

        artifact_payload = self._response_payload(
            started.request,
            result,
            report.effective_batch_size,
        )
        annotation_path = resolve_workspace_path(
            workspace_root,
            str(started.item["annotation_relative_path"]),
        )
        if annotation_path.is_file() and not overwrite_existing:
            return _EvaluatedItem(
                started=started,
                result=result,
                artifact_payload=artifact_payload,
                attempt_status="skipped_existing",
                item_status=JobItemStatus.SKIPPED,
                error=None,
                validation_status=None,
            )
        return _EvaluatedItem(
            started=started,
            result=result,
            artifact_payload=artifact_payload,
            attempt_status=None,
            item_status=None,
            error=None,
            validation_status=validation.status.value,
        )

    def _save_annotations(
        self,
        project_id: str,
        successful: Sequence[_SuccessfulItem],
    ) -> tuple[list[_SuccessfulItem], list[tuple[_SuccessfulItem, Exception]]]:
        if not successful:
            return [], []
        annotations = [
            GeneratedAnnotation(
                asset_id=item.started.asset_id,
                content=item.result.content,
            )
            for item in successful
        ]
        try:
            self._annotations.save_generated_batch(project_id, annotations)
            return list(successful), []
        except Exception:
            # The batch writer has already rolled back every file and DB row.
            # Retry individually so one bad target does not discard unrelated work.
            committed: list[_SuccessfulItem] = []
            failed: list[tuple[_SuccessfulItem, Exception]] = []
            for item in successful:
                try:
                    self._annotations.save_generated(
                        project_id,
                        item.started.asset_id,
                        item.result.content,
                    )
                except Exception as error:
                    failed.append((item, error))
                else:
                    committed.append(item)
            return committed, failed

    @staticmethod
    def _response_payload(
        request: dict[str, object],
        result: TaggerInferenceResult,
        effective_batch_size: int,
        *,
        validation_error: str | None = None,
    ) -> dict[str, object]:
        payload: dict[str, object] = {
            "artifact_version": 2,
            "kind": "response",
            "request": request,
            "content": result.content,
            "reasoning_content": None,
            "finish_reason": "local_inference",
            "input_tokens": None,
            "output_tokens": None,
            "raw": {
                "execution_provider": result.provider,
                "inference_ms": result.inference_ms,
                "batch_inference_ms": result.batch_inference_ms,
                "inference_batch_size": result.batch_size,
                "effective_batch_size": effective_batch_size,
                "tags": [tag.model_dump() for tag in result.tags],
            },
        }
        if validation_error is not None:
            payload["validation_error"] = validation_error
        return payload

    @staticmethod
    def _save_artifacts(
        workspace_root: Path,
        runs_root: Path,
        job_id: str,
        payloads: Sequence[tuple[StartedTaggerItem, dict[str, object]]],
    ) -> dict[str, str]:
        staged = [
            (
                item,
                runs_root / job_id / item.asset_id / f"attempt-{item.attempt_number}.json",
                json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
            )
            for item, payload in payloads
        ]
        paths: dict[str, str] = {}
        for item, path, content in staged:
            atomic_write_text(path, content)
            paths[item.item_id] = path.relative_to(workspace_root).as_posix()
        return paths


def request_snapshot(
    profile: TaggerExecutionProfile,
    image_path: Path,
) -> dict[str, object]:
    return {
        "system_prompt": "",
        "user_prompt": "",
        "image_filename": image_path.name,
        "parameters": {
            "execution_backend": "local_tagger",
            "provider_type": "local_tagger",
            "provider_profile_name": profile.name,
            "model": profile.model_label,
            "adapter_id": profile.adapter_id,
            "installation_id": profile.installation_id,
            "model_version": profile.model_version,
            "threshold": profile.threshold,
            "categories": profile.categories,
            "device": profile.device.value,
            "batch_size": profile.batch_size,
        },
    }


def resolve_workspace_path(workspace_root: Path, relative_path: str) -> Path:
    root = workspace_root.resolve()
    path = (root / relative_path).resolve()
    if not path.is_relative_to(root):
        raise ValueError("任务条目路径超出当前工作区。")
    return path
