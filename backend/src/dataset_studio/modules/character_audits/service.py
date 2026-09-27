"""Application operations; the annotation store remains the only tag writer."""

from __future__ import annotations

import logging
import sqlite3
import uuid
from contextlib import closing
from typing import Protocol

from PIL import Image

from dataset_studio.core.errors import ResourceConflictError, WorkspaceNotFoundError
from dataset_studio.core.sqlite import connect, transaction
from dataset_studio.core.time import utc_now_iso
from dataset_studio.modules.annotations.models import AnnotationStatus
from dataset_studio.modules.annotations.repository import AnnotationRepository
from dataset_studio.modules.assets.service import AssetService
from dataset_studio.modules.character_audits.models import (
    ACTIVE_STATUSES,
    ApplyPreview,
    AuditCreateRequest,
    AuditOperation,
    MembershipPreview,
    PrepareTagsRequest,
    ResolutionsUpdate,
    ReviewUpdate,
)
from dataset_studio.modules.character_audits.repository import (
    check_version,
    get_operation,
    insert_operation,
    read_operation,
    save_operation,
    write_operation,
)
from dataset_studio.modules.character_audits.rules import (
    build_inventory,
    build_preview,
    character_prompt,
    membership_preview,
    validate_decisions,
    validate_resolutions,
)
from dataset_studio.modules.character_audits.snapshots import (
    read_assets,
    scope_asset_ids,
    validate_current_inputs,
    validate_files,
)
from dataset_studio.modules.character_audits.vocabulary import load_manifest, resolve_semantics
from dataset_studio.modules.jobs.models import ExecutionBackend, JobCreateRequest, JobScope
from dataset_studio.modules.jobs.repository import write_job_in_transaction
from dataset_studio.modules.jobs.service import JobService
from dataset_studio.modules.output_resources import (
    OutputResourceClaim,
    annotation_document_resource_key,
    hold_output_resources,
)
from dataset_studio.modules.presets.service import PresetService
from dataset_studio.modules.tag_dictionaries.service import TagDictionaryService
from dataset_studio.modules.taggers.service import TaggerService
from dataset_studio.modules.workspaces.service import WorkspaceService

LOGGER = logging.getLogger("dataset_studio.character_audits")


class AuditContext(Protocol):
    workspaces: WorkspaceService
    presets: PresetService
    jobs: JobService
    assets: AssetService
    tag_dictionaries: TagDictionaryService
    taggers: TaggerService


def preview_membership(
    context: AuditContext, project_id: str, request: AuditCreateRequest
) -> MembershipPreview:
    paths, _ = context.workspaces.get(project_id)
    with closing(connect(paths.database)) as connection:
        assets = read_assets(connection, scope_asset_ids(connection, request))
    return membership_preview(assets, request.profiles)


def create(context: AuditContext, project_id: str, request: AuditCreateRequest) -> AuditOperation:
    paths, _ = context.workspaces.get(project_id)
    load_manifest(context.tag_dictionaries.dictionary_root(), request.vocabulary_id)
    provider = context.presets.resolve_execution_profile(
        context.presets.get_provider(request.provider_profile_id), request.model_id
    )
    with closing(connect(paths.database)) as connection:
        assets = read_assets(connection, scope_asset_ids(connection, request))
        references = read_assets(
            connection, [profile.reference_asset_id for profile in request.profiles]
        )
    if not assets:
        raise ValueError("审查范围没有图片，请重新选择素材。")
    validate_files(paths.root, references)
    for reference in references:
        with Image.open(paths.root / reference.relative_path) as image:
            image.verify()
    now = utc_now_iso()
    operation = AuditOperation(
        id=str(uuid.uuid4()),
        status="draft",
        version=1,
        created_at=now,
        updated_at=now,
        request=request,
        provider=provider,
        source_assets=assets,
        references=references,
        reviews=[],
        resolutions=[],
        attempts=[],
        prerequisite_job_id=None,
        error=None,
        applied_token=None,
        applied_revision_ids=[],
    )
    insert_operation(paths.database, operation)
    return operation


def prepare_tags(
    context: AuditContext, project_id: str, operation_id: str, request: PrepareTagsRequest
) -> AuditOperation:
    paths, _ = context.workspaces.get(project_id)
    operation = get_operation(paths.database, operation_id)
    check_version(operation, request.version)
    if operation.status not in {"draft", "failed", "stopped", "interrupted"} or operation.reviews:
        raise ResourceConflictError("只有尚未开始模型审查的任务可以补齐标签。")
    if operation.prerequisite_job_id:
        previous = context.jobs.get(project_id, operation.prerequisite_job_id, include_items=False)
        if previous.status in {"queued", "running", "stopping"}:
            raise ResourceConflictError("前置打标任务尚未结束，请先停止或等待。")
    context.jobs.ensure_inactive(project_id)
    with context.taggers.catalog_guard():
        creation = context.jobs.prepare_creation(
            project_id,
            JobCreateRequest(
                execution_backend=ExecutionBackend.LOCAL_TAGGER,
                tagger_profile_id=request.tagger_profile_id,
                scope=JobScope.SELECTED,
                asset_ids=[asset.asset_id for asset in operation.source_assets],
                overwrite_existing=request.overwrite_existing,
            ),
        )
        with transaction(paths.database) as connection:
            current = read_operation(connection, operation_id)
            check_version(current, request.version)
            write_job_in_transaction(connection, creation)
            updated = write_operation(
                connection,
                current.model_copy(
                    update={
                        "status": "preparing",
                        "prerequisite_job_id": creation.job_id,
                        "error": None,
                    }
                ),
            )
    context.workspaces.mark_worker_activity(project_id, "jobs")
    context.workspaces.mark_worker_activity(project_id, "character_audits")
    return updated


def freeze_inputs(
    context: AuditContext, project_id: str, operation: AuditOperation
) -> AuditOperation:
    paths, _ = context.workspaces.get(project_id)
    context.jobs.ensure_inactive(project_id)
    if operation.prerequisite_job_id:
        job = context.jobs.get(project_id, operation.prerequisite_job_id, include_items=False)
        if job.status != "completed" or job.failed:
            raise ResourceConflictError(
                "前置打标尚未完整成功或存在候选结果，请在原任务处理后恢复审查。"
            )
    with closing(connect(paths.database)) as connection:
        assets = read_assets(connection, [asset.asset_id for asset in operation.source_assets])
        references = read_assets(
            connection, [profile.reference_asset_id for profile in operation.request.profiles]
        )
    for old, new in zip(operation.source_assets, assets, strict=True):
        if (old.image_hash, old.relative_path) != (new.image_hash, new.relative_path):
            raise ResourceConflictError("准备标签期间素材已变化，请重新创建审查。")
    if any(
        (old.image_hash, old.relative_path) != (new.image_hash, new.relative_path)
        for old, new in zip(operation.references, references, strict=True)
    ):
        raise ResourceConflictError("准备期间参考图已变化，请重新创建审查。")
    stats = membership_preview(assets, operation.request.profiles)
    if stats.missing_tags_count or stats.candidate_count:
        raise ResourceConflictError(
            f"范围内还有 {stats.missing_tags_count} 张图片缺少可用 Tags、"
            f"{stats.candidate_count} 个候选结果，请先处理。"
        )
    if any(count == 0 for count in stats.member_counts):
        raise ValueError("至少一个角色没有归属图片，请检查触发词或目录配置并重新创建。")
    validate_files(paths.root, [*assets, *references])
    semantic = resolve_semantics(
        context.tag_dictionaries.dictionary_root(),
        operation.request.vocabulary_id,
        list({tag.name for asset in assets for tag in asset.tags}),
    )
    reviews = [
        build_inventory(
            assets, operation.request.profiles, index, semantic, operation.request.minimum_count
        )
        for index in range(len(operation.request.profiles))
    ]
    if any(not review.inventory for review in reviews):
        raise ValueError(
            "至少一个角色没有标签达到最低出现次数，请调整阈值后重新创建任务；未调用模型。"
        )
    return operation.model_copy(
        update={"source_assets": assets, "references": references, "reviews": reviews}
    )


def start(
    context: AuditContext, project_id: str, operation_id: str, version: int
) -> AuditOperation:
    paths, _ = context.workspaces.get(project_id)
    operation = get_operation(paths.database, operation_id)
    check_version(operation, version)
    if operation.status not in {"draft", "stopped", "interrupted", "failed"}:
        raise ResourceConflictError("此审查状态不能启动或恢复。")
    load_manifest(context.tag_dictionaries.dictionary_root(), operation.request.vocabulary_id)
    context.jobs.ensure_inactive(project_id)
    if operation.reviews:
        with closing(connect(paths.database)) as connection:
            validate_current_inputs(
                connection, paths.root, operation.source_assets, operation.references
            )
    else:
        operation = freeze_inputs(context, project_id, operation)
    updated = save_operation(
        paths.database, operation.model_copy(update={"status": "queued", "error": None})
    )
    context.workspaces.mark_worker_activity(project_id, "character_audits")
    return updated


def stop(context: AuditContext, project_id: str, operation_id: str) -> AuditOperation:
    paths, _ = context.workspaces.get(project_id)
    with transaction(paths.database) as connection:
        operation = read_operation(connection, operation_id)
        if operation.status not in ACTIVE_STATUSES:
            return operation
        status = "stopping" if operation.status == "running" else "stopped"
        updated = write_operation(connection, operation.model_copy(update={"status": status}))
    if operation.prerequisite_job_id:
        job = context.jobs.get(project_id, operation.prerequisite_job_id, include_items=False)
        if job.status in {"queued", "running", "stopping"}:
            context.jobs.stop(project_id, operation.prerequisite_job_id, include_items=False)
    return updated


def save_review(
    context: AuditContext, project_id: str, operation_id: str, index: int, request: ReviewUpdate
) -> AuditOperation:
    paths, _ = context.workspaces.get(project_id)
    operation = get_operation(paths.database, operation_id)
    check_version(operation, request.version)
    if operation.status != "review" or not 0 <= index < len(operation.reviews):
        raise ResourceConflictError("任务尚未进入人工审阅，或角色不存在。")
    validate_decisions(
        request.decisions,
        operation.reviews[index].inventory,
        [p.trigger for p in operation.request.profiles],
        operation.request.profiles[index].trigger,
    )
    review = operation.reviews[index].model_copy(
        update={
            "decisions": request.decisions,
            "confirmed": True,
            "prompt": character_prompt(operation.request.profiles[index], request.decisions),
        }
    )
    return save_operation(
        paths.database,
        operation.model_copy(
            update={
                "reviews": [
                    review if i == index else item for i, item in enumerate(operation.reviews)
                ],
                "resolutions": [],
            }
        ),
    )


def save_resolutions(
    context: AuditContext, project_id: str, operation_id: str, request: ResolutionsUpdate
) -> AuditOperation:
    paths, _ = context.workspaces.get(project_id)
    operation = get_operation(paths.database, operation_id)
    check_version(operation, request.version)
    if operation.status != "review":
        raise ResourceConflictError("只有人工审阅阶段可以处理冲突。")
    validate_resolutions(operation, request.resolutions)
    return save_operation(
        paths.database, operation.model_copy(update={"resolutions": request.resolutions})
    )


def redo_visual(
    context: AuditContext, project_id: str, operation_id: str, index: int, version: int
) -> AuditOperation:
    paths, _ = context.workspaces.get(project_id)
    operation = get_operation(paths.database, operation_id)
    check_version(operation, version)
    if operation.status != "review" or not 0 <= index < len(operation.reviews):
        raise ResourceConflictError("只有人工审阅阶段的有效角色可以重新视觉审查。")
    with closing(connect(paths.database)) as connection:
        validate_current_inputs(
            connection, paths.root, operation.source_assets, operation.references
        )
    review = operation.reviews[index]
    reset = review.model_copy(
        update={"completed_stages": ["text"], "suggested": review.initial, "confirmed": False}
    )
    updated = save_operation(
        paths.database,
        operation.model_copy(
            update={
                "reviews": [
                    reset if i == index else item for i, item in enumerate(operation.reviews)
                ],
                "status": "queued",
                "resolutions": [],
                "error": None,
            }
        ),
    )
    context.workspaces.mark_worker_activity(project_id, "character_audits")
    return updated


def preview(context: AuditContext, project_id: str, operation_id: str) -> ApplyPreview:
    paths, _ = context.workspaces.get(project_id)
    operation = get_operation(paths.database, operation_id)
    if operation.status != "review":
        raise ResourceConflictError("任务尚未进入人工审阅，不能生成应用预览。")
    load_manifest(context.tag_dictionaries.dictionary_root(), operation.request.vocabulary_id)
    with closing(connect(paths.database)) as connection:
        validate_current_inputs(
            connection, paths.root, operation.source_assets, operation.references
        )
    return build_preview(operation)


def apply(context: AuditContext, project_id: str, operation_id: str, token: str) -> AuditOperation:
    paths, _ = context.workspaces.get(project_id)
    operation = get_operation(paths.database, operation_id)
    claims = [
        OutputResourceClaim(annotation_document_resource_key(asset.asset_id, "tags"))
        for asset in sorted(operation.source_assets, key=lambda item: item.asset_id)
    ]
    with hold_output_resources(paths.database, claims), transaction(paths.database) as connection:
        operation = read_operation(connection, operation_id)
        if operation.status == "applied" and operation.applied_token == token:
            return operation
        if operation.status != "review":
            raise ResourceConflictError("任务不处于可应用的人工审阅阶段。")
        load_manifest(context.tag_dictionaries.dictionary_root(), operation.request.vocabulary_id)
        validate_current_inputs(
            connection, paths.root, operation.source_assets, operation.references
        )
        if not all(review.confirmed for review in operation.reviews):
            raise ResourceConflictError("请逐个角色确认审查决定后再应用。")
        plan = build_preview(operation)
        if plan.preview_token != token:
            raise ResourceConflictError("应用预览已过期，请重新预览。")
        if any(item.resolution is None for item in plan.conflicts):
            raise ResourceConflictError("共享图片仍有未人工裁决的标签冲突，未写入任何 Tags。")
        originals = {asset.asset_id: asset for asset in operation.source_assets}
        repository = AnnotationRepository(paths.database)
        revisions = []
        for change in plan.changes:
            asset = originals[change.asset_id]
            result = repository.write_tags_in_transaction(
                connection,
                asset_id=asset.asset_id,
                tags=change.after,
                source="character_audit",
                validation_status=AnnotationStatus.VALID
                if change.after
                else AnnotationStatus.EMPTY,
                image_content_hash=asset.image_hash,
                expected_head_revision_id=asset.revision_id,
                review=False,
                source_job_item_id=None,
                input_revisions=(),
                metadata={"character_audit_id": operation.id},
                allow_candidate_on_conflict=False,
            )
            revisions.append(result.revision_id)
        return write_operation(
            connection,
            operation.model_copy(
                update={
                    "status": "applied",
                    "applied_token": token,
                    "applied_revision_ids": revisions,
                }
            ),
        )


def _active_operation_ids(workspaces: WorkspaceService) -> dict[str, list[str]]:
    result: dict[str, list[str]] = {}
    for project_id in workspaces.recent_project_ids():
        try:
            paths, _ = workspaces.get(project_id)
            with closing(connect(paths.database)) as connection:
                ids = [
                    str(row[0])
                    for row in connection.execute(
                        "SELECT id FROM character_audits "
                        "WHERE status IN ('preparing', 'queued', 'running', 'stopping')"
                    )
                ]
        except (WorkspaceNotFoundError, OSError, ValueError, sqlite3.Error) as error:
            LOGGER.warning(
                "Skipping unavailable character audit workspace",
                extra={"project_id": project_id, "error": str(error)},
            )
            continue
        if ids:
            result[project_id] = ids
    return result


def active_project_ids(workspaces: WorkspaceService) -> set[str]:
    return set(_active_operation_ids(workspaces))


def active_count(workspaces: WorkspaceService) -> int:
    return sum(len(ids) for ids in _active_operation_ids(workspaces).values())


def stop_all(context: AuditContext) -> int:
    count = 0
    for project_id, ids in _active_operation_ids(context.workspaces).items():
        for operation_id in ids:
            stop(context, project_id, operation_id)
            count += 1
    return count
