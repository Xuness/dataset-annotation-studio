from __future__ import annotations

import asyncio
from collections.abc import Sequence
from pathlib import Path
from typing import Protocol

from dataset_studio.modules.annotations.service import AnnotationService
from dataset_studio.modules.jobs.execution_repository import (
    ItemCompletion,
    JobExecutionRepository,
)
from dataset_studio.modules.jobs.executors.local_tagger_commit import (
    LocalTaggerBatchCommitter,
    StartedTaggerItem,
    request_snapshot,
    resolve_workspace_path,
)
from dataset_studio.modules.jobs.models import JobItemStatus, JobKind
from dataset_studio.modules.taggers.models import TaggerExecutionProfile
from dataset_studio.modules.taggers.pipeline import (
    TaggerBatchPipeline,
    TaggerPipelineInput,
    TaggerPipelineStopped,
)
from dataset_studio.modules.taggers.runtime import TaggerRuntime


class LocalTaggerExecutorContainer(Protocol):
    annotations: AnnotationService
    tagger_runtime: TaggerRuntime


class LocalTaggerJobExecutor:
    def __init__(self, container: LocalTaggerExecutorContainer) -> None:
        self._container = container
        self._committer = LocalTaggerBatchCommitter(container.annotations)

    async def process_batch(
        self,
        project_id: str,
        workspace_root: Path,
        runs_root: Path,
        job: dict[str, object],
        items: Sequence[dict[str, object]],
        repository: JobExecutionRepository,
        profile: TaggerExecutionProfile,
    ) -> None:
        if not items:
            return
        if JobKind(str(job["kind"])) != JobKind.ANNOTATION:
            repository.finish_batch(
                [],
                [
                    ItemCompletion(
                        item_id=str(item["id"]),
                        status=JobItemStatus.FAILED,
                        error="本地打标器不能执行翻译任务。",
                        validation_status="invalid_backend",
                    )
                    for item in items
                ],
            )
            return

        job_id = str(job["id"])
        if repository.is_stop_requested(job_id):
            self._committer.interrupt_unstarted(repository, items)
            return

        overwrite_existing = bool(job["overwrite_existing"])
        candidates: list[tuple[dict[str, object], Path]] = []
        precompleted: list[ItemCompletion] = []
        for item in items:
            item_id = str(item["id"])
            try:
                annotation_path = resolve_workspace_path(
                    workspace_root,
                    str(item["annotation_relative_path"]),
                )
                image_path = resolve_workspace_path(
                    workspace_root,
                    str(item["relative_path"]),
                )
            except ValueError as error:
                precompleted.append(
                    ItemCompletion(
                        item_id=item_id,
                        status=JobItemStatus.FAILED,
                        error=str(error),
                        validation_status="invalid_path",
                    )
                )
                continue
            if annotation_path.is_file() and not overwrite_existing:
                precompleted.append(ItemCompletion(item_id=item_id, status=JobItemStatus.SKIPPED))
                continue
            candidates.append((item, image_path))
        repository.finish_batch([], precompleted)
        if not candidates:
            return

        attempts = repository.start_attempts([str(item["id"]) for item, _ in candidates])
        started = [
            StartedTaggerItem(
                item=item,
                image_path=image_path,
                attempt_id=attempts[str(item["id"])][0],
                attempt_number=attempts[str(item["id"])][1],
                request=request_snapshot(profile, image_path),
            )
            for item, image_path in candidates
        ]
        try:
            report = await asyncio.to_thread(
                TaggerBatchPipeline(self._container.tagger_runtime).run,
                profile,
                [
                    TaggerPipelineInput(key=item.item_id, image_path=item.image_path)
                    for item in started
                ],
                should_stop=lambda: repository.is_stop_requested(job_id),
            )
            if repository.is_stop_requested(job_id):
                self._committer.interrupt_started(
                    repository,
                    started,
                    "任务已由用户停止；本批推理结果未写入。",
                )
                return
            self._committer.commit(
                project_id=project_id,
                workspace_root=workspace_root,
                runs_root=runs_root,
                job_id=job_id,
                overwrite_existing=overwrite_existing,
                started=started,
                report=report,
                repository=repository,
                should_stop=lambda: repository.is_stop_requested(job_id),
            )
        except TaggerPipelineStopped:
            self._committer.interrupt_started(repository, started, "任务已由用户停止。")
        except asyncio.CancelledError:
            self._committer.interrupt_started(
                repository,
                started,
                "应用关闭或任务被停止。",
            )
            raise
        except Exception as error:
            self._committer.fail_started(
                repository,
                workspace_root,
                runs_root,
                job_id,
                started,
                str(error) or type(error).__name__,
            )
