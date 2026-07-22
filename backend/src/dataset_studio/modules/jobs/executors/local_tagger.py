from __future__ import annotations

import asyncio
import json
from pathlib import Path
from typing import Protocol

from dataset_studio.core.files import atomic_write_text
from dataset_studio.modules.annotations.service import AnnotationService
from dataset_studio.modules.annotations.tag_balance import validate_tag_balance
from dataset_studio.modules.assets.service import AssetService
from dataset_studio.modules.jobs.execution_repository import JobExecutionRepository
from dataset_studio.modules.jobs.models import JobItemStatus, JobKind
from dataset_studio.modules.taggers.models import TaggerExecutionProfile
from dataset_studio.modules.taggers.runtime import TaggerRuntime


class LocalTaggerExecutorContainer(Protocol):
    assets: AssetService
    annotations: AnnotationService
    tagger_runtime: TaggerRuntime


class LocalTaggerJobExecutor:
    def __init__(self, container: LocalTaggerExecutorContainer) -> None:
        self._container = container

    async def process(
        self,
        project_id: str,
        workspace_root: Path,
        runs_root: Path,
        job: dict[str, object],
        item: dict[str, object],
        repository: JobExecutionRepository,
        profile: TaggerExecutionProfile,
    ) -> None:
        if JobKind(str(job["kind"])) != JobKind.ANNOTATION:
            repository.finish_item(
                str(item["id"]),
                JobItemStatus.FAILED,
                error="本地打标器不能执行翻译任务。",
                validation_status="invalid_backend",
            )
            return
        job_id = str(job["id"])
        item_id = str(item["id"])
        asset_id = str(item["asset_id"])
        if repository.is_stop_requested(job_id):
            repository.finish_item(item_id, JobItemStatus.INTERRUPTED)
            return
        image_path = self._container.assets.image_path(project_id, asset_id)
        attempt_id, attempt_number = repository.start_attempt(item_id)
        request = self._request_snapshot(profile, image_path)
        artifact_path = self._save_artifact(
            workspace_root,
            runs_root,
            job_id,
            asset_id,
            attempt_number,
            {"artifact_version": 2, "kind": "request", "request": request},
        )
        try:
            result = await asyncio.to_thread(
                self._container.tagger_runtime.tag,
                profile,
                image_path,
            )
            response_payload = {
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
                    "tags": [tag.model_dump() for tag in result.tags],
                },
            }
            artifact_path = self._save_artifact(
                workspace_root,
                runs_root,
                job_id,
                asset_id,
                attempt_number,
                response_payload,
            )
            if repository.is_stop_requested(job_id):
                repository.finish_attempt(
                    attempt_id,
                    status="interrupted",
                    response_content=result.content,
                    error_message="任务已由用户停止；本次推理结果未写入。",
                    provider_payload_path=artifact_path,
                    finish_reason="local_inference",
                )
                repository.finish_item(item_id, JobItemStatus.INTERRUPTED)
                return
            validation = validate_tag_balance(result.content)
            if not validation.valid:
                message = validation.issues[0].message
                repository.finish_attempt(
                    attempt_id,
                    status="validation_failed",
                    response_content=result.content,
                    error_message=message,
                    provider_payload_path=artifact_path,
                    finish_reason="local_inference",
                )
                repository.finish_item(
                    item_id,
                    JobItemStatus.FAILED,
                    error=message,
                    validation_status=validation.status.value,
                )
                return
            annotation_path = workspace_root / str(item["annotation_relative_path"])
            if annotation_path.is_file() and not bool(job["overwrite_existing"]):
                repository.finish_attempt(
                    attempt_id,
                    status="skipped_existing",
                    response_content=result.content,
                    provider_payload_path=artifact_path,
                    finish_reason="local_inference",
                )
                repository.finish_item(item_id, JobItemStatus.SKIPPED)
                return
            self._container.annotations.save_generated(project_id, asset_id, result.content)
            repository.finish_attempt(
                attempt_id,
                status="succeeded",
                response_content=result.content,
                provider_payload_path=artifact_path,
                finish_reason="local_inference",
            )
            repository.finish_item(
                item_id,
                JobItemStatus.SUCCEEDED,
                validation_status=validation.status.value,
            )
        except asyncio.CancelledError:
            repository.finish_attempt(
                attempt_id,
                status="interrupted",
                error_message="应用关闭或任务被停止。",
                provider_payload_path=artifact_path,
            )
            raise
        except Exception as error:
            message = str(error) or type(error).__name__
            artifact_path = self._save_artifact(
                workspace_root,
                runs_root,
                job_id,
                asset_id,
                attempt_number,
                {
                    "artifact_version": 2,
                    "kind": "error",
                    "request": request,
                    "error": message,
                },
            )
            repository.finish_attempt(
                attempt_id,
                status="inference_failed",
                error_message=message,
                provider_payload_path=artifact_path,
            )
            repository.finish_item(
                item_id,
                JobItemStatus.FAILED,
                error=message,
                validation_status="inference_failed",
            )

    @staticmethod
    def _request_snapshot(
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
            },
        }

    @staticmethod
    def _save_artifact(
        workspace_root: Path,
        runs_root: Path,
        job_id: str,
        asset_id: str,
        attempt_number: int,
        payload: dict[str, object],
    ) -> str:
        path = runs_root / job_id / asset_id / f"attempt-{attempt_number}.json"
        atomic_write_text(path, json.dumps(payload, ensure_ascii=False, indent=2) + "\n")
        return path.relative_to(workspace_root).as_posix()
