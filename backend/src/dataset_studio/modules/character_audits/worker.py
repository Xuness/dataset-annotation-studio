"""Durable reference-based audit execution, independent of per-image jobs."""

from __future__ import annotations

import asyncio
import logging
import sqlite3
import uuid
from contextlib import closing, suppress
from typing import Protocol

from dataset_studio.core.errors import StudioError, WorkspaceNotFoundError
from dataset_studio.core.sqlite import connect, transaction
from dataset_studio.core.time import utc_now_iso
from dataset_studio.modules.character_audits.models import (
    AuditAttempt,
    AuditOperation,
    AuditStage,
    ModelAnswer,
    ProfileReview,
)
from dataset_studio.modules.character_audits.prompts import build_prompt
from dataset_studio.modules.character_audits.repository import (
    claim_operation,
    get_operation,
    read_operation,
    recover_operations,
    write_operation,
)
from dataset_studio.modules.character_audits.rules import (
    COLORS,
    MUTABLE,
    character_prompt,
    validate_decisions,
)
from dataset_studio.modules.character_audits.service import AuditContext, freeze_inputs
from dataset_studio.modules.character_audits.snapshots import validate_current_inputs
from dataset_studio.modules.character_audits.vocabulary import load_manifest
from dataset_studio.modules.jobs.provider_call import JobStopped, complete_until_stopped
from dataset_studio.modules.providers.codex_runtime import CodexRuntime
from dataset_studio.modules.providers.factory import create_provider
from dataset_studio.modules.providers.models import (
    MultimodalRequest,
    ProviderRequestError,
    ProviderResponse,
)

LOGGER = logging.getLogger("dataset_studio.character_audits")


class AuditWorkerContext(AuditContext, Protocol):
    codex: CodexRuntime


def next_stage(review: ProfileReview) -> AuditStage | None:
    if "text" not in review.completed_stages:
        return "text"
    if "visual" not in review.completed_stages:
        return "visual"
    needs_resolution = any(item.cluster is not None for item in review.inventory) or any(
        item.decision == "uncertain" and item.category in MUTABLE for item in review.suggested
    )
    needs_resolution = needs_resolution or any(
        item.category in {"clothing", "footwear", "legwear", "accessory"}
        and item.decision in {"keep", "replace"}
        and not set((item.replacement or item.tag).replace("_", " ").split()) & COLORS
        for item in review.suggested
    )
    if needs_resolution and "resolution" not in review.completed_stages:
        return "resolution"
    return None


async def process_stage(
    context: AuditWorkerContext,
    project_id: str,
    operation_id: str,
    index: int,
    stage: AuditStage,
    stopped: asyncio.Event,
) -> None:
    paths, _ = context.workspaces.get(project_id)
    operation = get_operation(paths.database, operation_id)
    load_manifest(context.tag_dictionaries.dictionary_root(), operation.request.vocabulary_id)
    with closing(connect(paths.database)) as connection:
        validate_current_inputs(
            connection, paths.root, operation.source_assets, operation.references
        )
    system_prompt, user_prompt = build_prompt(operation, index, stage)
    provider = create_provider(operation.provider.provider_type, context.codex)
    credential = context.presets.get_provider_credential(operation.provider)
    reference = operation.references[index]
    request = MultimodalRequest(
        image_path=paths.root / reference.relative_path if stage != "text" else None,
        system_prompt=system_prompt,
        user_prompt=user_prompt,
    )
    for retry in range(operation.request.retry_limit + 1):
        with transaction(paths.database) as connection:
            current = read_operation(connection, operation_id)
            if stopped.is_set() or current.status != "running":
                raise JobStopped
            attempt = AuditAttempt(
                id=str(uuid.uuid4()),
                profile_index=index,
                stage=stage,
                attempt=1
                + sum(
                    item.profile_index == index and item.stage == stage for item in current.attempts
                ),
                status="running",
                started_at=utc_now_iso(),
                finished_at=None,
                request_system=system_prompt,
                request_user=user_prompt,
                response=None,
                error=None,
            )
            write_operation(
                connection, current.model_copy(update={"attempts": [*current.attempts, attempt]})
            )
        response: ProviderResponse | None = None
        try:
            response = await complete_until_stopped(
                provider,
                operation.provider,
                credential,
                request,
                lambda: (
                    stopped.is_set()
                    or get_operation(paths.database, operation_id).status != "running"
                ),
                poll_interval=0.5,
            )
            answer = ModelAnswer.model_validate_json(response.content)
            validate_decisions(
                answer.items,
                operation.reviews[index].inventory,
                [p.trigger for p in operation.request.profiles],
                operation.request.profiles[index].trigger,
            )
        except (ValueError, ProviderRequestError, JobStopped, asyncio.CancelledError) as error:
            detail = str(error)
            if isinstance(error, ProviderRequestError):
                detail = (
                    f"供应商请求失败；model={operation.provider.model_id}; stage={stage}; "
                    f"profile={index}; status={error.status_code}; "
                    f"response={error.response_text}; error={error}"
                )
            interrupted = isinstance(error, (JobStopped, asyncio.CancelledError))
            with transaction(paths.database) as connection:
                current = read_operation(connection, operation_id)
                finished = attempt.model_copy(
                    update={
                        "status": "interrupted" if interrupted else "failed",
                        "finished_at": utc_now_iso(),
                        "response": response,
                        "error": detail or "调用已中断；远端可能已产生费用。",
                    }
                )
                write_operation(
                    connection,
                    current.model_copy(
                        update={
                            "attempts": [
                                finished if item.id == attempt.id else item
                                for item in current.attempts
                            ]
                        }
                    ),
                )
            if interrupted:
                raise
            LOGGER.warning(
                "Character audit request failed",
                extra={
                    "project_id": project_id,
                    "audit_id": operation_id,
                    "profile_index": index,
                    "stage": stage,
                    "attempt": attempt.attempt,
                    "error": detail,
                },
            )
            if retry == operation.request.retry_limit or (
                isinstance(error, ProviderRequestError)
                and error.status_code in {400, 401, 403, 404}
            ):
                if isinstance(error, ProviderRequestError):
                    raise ProviderRequestError(
                        detail, status_code=error.status_code, response_text=error.response_text
                    ) from error
                raise
            with suppress(TimeoutError):
                await asyncio.wait_for(stopped.wait(), timeout=min(2**retry, 8))
            continue
        with transaction(paths.database) as connection:
            current = read_operation(connection, operation_id)
            review = current.reviews[index]
            reviewed = review.model_copy(
                update={
                    "initial": answer.items if stage == "text" else review.initial,
                    "suggested": answer.items,
                    "completed_stages": [*review.completed_stages, stage],
                }
            )
            finished = attempt.model_copy(
                update={"status": "succeeded", "finished_at": utc_now_iso(), "response": response}
            )
            write_operation(
                connection,
                current.model_copy(
                    update={
                        "attempts": [
                            finished if item.id == attempt.id else item for item in current.attempts
                        ],
                        "reviews": [
                            reviewed if i == index else item
                            for i, item in enumerate(current.reviews)
                        ],
                    }
                ),
            )
        return


async def process_operation(
    context: AuditWorkerContext, project_id: str, operation: AuditOperation, stopped: asyncio.Event
) -> None:
    paths, _ = context.workspaces.get(project_id)
    try:
        if not operation.reviews:
            if operation.prerequisite_job_id:
                job = context.jobs.get(
                    project_id, operation.prerequisite_job_id, include_items=False
                )
                if job.status in {"queued", "running", "stopping"}:
                    with transaction(paths.database) as connection:
                        current = read_operation(connection, operation.id)
                        write_operation(
                            connection,
                            current.model_copy(
                                update={
                                    "status": "stopped"
                                    if current.status == "stopping" or stopped.is_set()
                                    else "preparing"
                                }
                            ),
                        )
                    return
            operation = freeze_inputs(context, project_id, operation)
            with transaction(paths.database) as connection:
                current = read_operation(connection, operation.id)
                if current.status != "running" or stopped.is_set():
                    raise JobStopped
                operation = write_operation(
                    connection,
                    current.model_copy(
                        update={
                            "source_assets": operation.source_assets,
                            "references": operation.references,
                            "reviews": operation.reviews,
                        }
                    ),
                )
        for index in range(len(operation.reviews)):
            while True:
                current = get_operation(paths.database, operation.id)
                if current.status != "running" or stopped.is_set():
                    raise JobStopped
                stage = next_stage(current.reviews[index])
                if stage is None:
                    break
                await process_stage(context, project_id, operation.id, index, stage, stopped)
        with transaction(paths.database) as connection:
            current = read_operation(connection, operation.id)
            if current.status != "running" or stopped.is_set():
                raise JobStopped
            reviews = [
                review.model_copy(
                    update={
                        "decisions": review.decisions or review.suggested,
                        "prompt": character_prompt(
                            current.request.profiles[index], review.decisions or review.suggested
                        ),
                    }
                )
                for index, review in enumerate(current.reviews)
            ]
            write_operation(
                connection,
                current.model_copy(update={"status": "review", "reviews": reviews, "error": None}),
            )
    except (JobStopped, asyncio.CancelledError) as error:
        with transaction(paths.database) as connection:
            current = read_operation(connection, operation.id)
            write_operation(
                connection,
                current.model_copy(
                    update={
                        "status": "stopped",
                        "error": "执行已停止，已完成的阶段与人工决定已保留。",
                    }
                ),
            )
        if isinstance(error, asyncio.CancelledError):
            raise
        if not stopped.is_set():
            LOGGER.info("Character audit stopped", extra={"audit_id": operation.id})
    except (ValueError, StudioError, ProviderRequestError, OSError, sqlite3.Error) as error:
        LOGGER.error(
            "Character audit failed",
            extra={"project_id": project_id, "audit_id": operation.id, "error": str(error)},
        )
        with transaction(paths.database) as connection:
            current = read_operation(connection, operation.id)
            write_operation(
                connection, current.model_copy(update={"status": "failed", "error": str(error)})
            )


async def run_character_audits(context: AuditWorkerContext, stopped: asyncio.Event) -> None:
    for project_id in context.workspaces.recent_project_ids():
        try:
            paths, _ = context.workspaces.get(project_id)
            recover_operations(paths.database)
            with closing(connect(paths.database)) as connection:
                has_active = connection.execute(
                    "SELECT 1 FROM character_audits WHERE status IN ('queued', 'preparing') LIMIT 1"
                ).fetchone()
        except (WorkspaceNotFoundError, OSError, ValueError, sqlite3.Error) as error:
            LOGGER.warning(
                "Skipping unavailable character audit workspace",
                extra={"project_id": project_id, "error": str(error)},
            )
            context.workspaces.clear_worker_activity(project_id, "character_audits")
            continue
        if has_active:
            context.workspaces.mark_worker_activity(project_id, "character_audits")
    LOGGER.info("Character audit worker is ready.")
    while not stopped.is_set():
        for candidate in context.workspaces.worker_candidates("character_audits"):
            try:
                paths, _ = context.workspaces.get(candidate.project_id)
                operation = claim_operation(paths.database)
            except (WorkspaceNotFoundError, OSError, ValueError, sqlite3.Error) as error:
                LOGGER.warning(
                    "Skipping unavailable character audit workspace",
                    extra={"project_id": candidate.project_id, "error": str(error)},
                )
                context.workspaces.clear_worker_activity(
                    candidate.project_id, "character_audits", requested_at=candidate.requested_at
                )
                continue
            if operation is None:
                context.workspaces.clear_worker_activity(
                    candidate.project_id, "character_audits", requested_at=candidate.requested_at
                )
                continue
            await process_operation(context, candidate.project_id, operation, stopped)
            if stopped.is_set():
                break
        with suppress(TimeoutError):
            await asyncio.wait_for(stopped.wait(), timeout=0.5)
    LOGGER.info("Character audit worker stopped.")
