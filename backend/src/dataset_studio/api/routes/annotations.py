from typing import Annotated

from fastapi import APIRouter, Depends

from dataset_studio.api.container import AppContainer
from dataset_studio.api.dependencies import get_container
from dataset_studio.modules.annotations.models import (
    AnnotationBatchDeleteRequest,
    AnnotationBatchDeleteResult,
    AnnotationBatchOptions,
    AnnotationBatchOptionsRequest,
    AnnotationBatchReviewRequest,
    AnnotationBatchReviewResult,
    AnnotationBatchTargetRequest,
    AnnotationBundle,
    AnnotationChannel,
    AnnotationChannelUpdate,
    AnnotationDocument,
    AnnotationReviewRequest,
    AnnotationRevision,
    AnnotationUpdate,
)

router = APIRouter(
    prefix="/workspaces/{project_id}/assets/{asset_id}/annotation",
    tags=["annotations"],
)
batch_router = APIRouter(
    prefix="/workspaces/{project_id}/annotations",
    tags=["annotations"],
)
channels_router = APIRouter(
    prefix="/workspaces/{project_id}/assets/{asset_id}/annotations",
    tags=["annotations"],
)
Container = Annotated[AppContainer, Depends(get_container)]


@router.get("", response_model=AnnotationDocument, deprecated=True)
def get_annotation(project_id: str, asset_id: str, container: Container):
    return container.annotations.get(project_id, asset_id)


@router.put("", response_model=AnnotationDocument, deprecated=True)
def save_annotation(project_id: str, asset_id: str, update: AnnotationUpdate, container: Container):
    with container.preprocessing.guard_workspace(project_id, f"save-annotation:{asset_id}"):
        container.asset_deletions.ensure_persisted_inactive(project_id)
        container.exports.ensure_inactive(project_id)
        return container.annotations.save(
            project_id,
            asset_id,
            update.content,
            expected_modified_at=update.expected_modified_at,
        )


@router.delete("", response_model=AnnotationDocument, deprecated=True)
def delete_annotation(project_id: str, asset_id: str, container: Container):
    with container.preprocessing.guard_workspace(project_id, f"delete-annotation:{asset_id}"):
        container.preprocessing.ensure_persisted_inactive(project_id)
        container.exports.ensure_inactive(project_id)
        container.jobs.ensure_inactive(project_id)
        container.asset_deletions.ensure_persisted_inactive(project_id)
        return container.annotations.delete(project_id, asset_id)


@router.get("/history", response_model=list[AnnotationRevision], deprecated=True)
def annotation_history(project_id: str, asset_id: str, container: Container):
    return container.annotations.history(
        project_id,
        asset_id,
        AnnotationChannel.DESCRIPTION,
    )


@batch_router.post("/delete", response_model=AnnotationBatchDeleteResult)
def delete_annotations(
    project_id: str,
    request: AnnotationBatchDeleteRequest,
    container: Container,
):
    with container.preprocessing.guard_workspace(project_id, "delete-annotations-batch"):
        container.preprocessing.ensure_persisted_inactive(project_id)
        container.exports.ensure_inactive(project_id)
        container.jobs.ensure_inactive(project_id)
        container.asset_deletions.ensure_persisted_inactive(project_id)
        return container.annotations.delete_many(
            project_id,
            request.asset_ids,
            channel=request.channel,
            language=request.language or "",
            targets=request.targets,
        )


@batch_router.post("/options", response_model=AnnotationBatchOptions)
def annotation_batch_options(
    project_id: str,
    request: AnnotationBatchOptionsRequest,
    container: Container,
):
    return container.annotations.batch_options(project_id, request.asset_ids)


@batch_router.post("/review", response_model=AnnotationBatchReviewResult)
def review_annotations(
    project_id: str,
    request: AnnotationBatchTargetRequest,
    container: Container,
):
    with container.preprocessing.guard_workspace(project_id, "review-annotations-batch"):
        container.asset_deletions.ensure_persisted_inactive(project_id)
        container.exports.ensure_inactive(project_id)
        return container.annotations.review_targets_many(
            project_id,
            request.asset_ids,
            request.targets,
        )


@batch_router.post(
    "/tags/confirm", response_model=AnnotationBatchReviewResult, include_in_schema=False
)
@batch_router.post("/tags/review", response_model=AnnotationBatchReviewResult)
def review_tag_annotations(
    project_id: str,
    request: AnnotationBatchReviewRequest,
    container: Container,
):
    with container.preprocessing.guard_workspace(project_id, "review-tags-batch"):
        container.asset_deletions.ensure_persisted_inactive(project_id)
        container.exports.ensure_inactive(project_id)
        return container.annotations.review_tags_many(project_id, request.asset_ids)


@channels_router.get("", response_model=AnnotationBundle)
def list_annotation_channels(project_id: str, asset_id: str, container: Container):
    return container.annotations.list(project_id, asset_id)


@channels_router.get("/{channel}", response_model=AnnotationDocument)
def get_annotation_channel(
    project_id: str,
    asset_id: str,
    channel: AnnotationChannel,
    container: Container,
    language: str = "",
):
    return container.annotations.get_channel(project_id, asset_id, channel, language)


@channels_router.put("/{channel}", response_model=AnnotationDocument)
def save_annotation_channel(
    project_id: str,
    asset_id: str,
    channel: AnnotationChannel,
    update: AnnotationChannelUpdate,
    container: Container,
    language: str = "",
):
    with container.preprocessing.guard_workspace(
        project_id,
        f"save-annotation:{asset_id}:{channel.value}:{language}",
    ):
        container.asset_deletions.ensure_persisted_inactive(project_id)
        container.exports.ensure_inactive(project_id)
        should_review = update.review or False
        if update.tags is not None:
            if channel != AnnotationChannel.TAGS:
                raise ValueError("只有 Tags 通道可以保存结构化 Tag。")
            result = container.annotations.save_tags(
                project_id,
                asset_id,
                update.tags,
                expected_head_revision_id=update.expected_head_revision_id,
                review=should_review,
            )
        elif channel == AnnotationChannel.TRANSLATION:
            assert update.content is not None
            return container.translations.save_manual(
                project_id,
                asset_id,
                language,
                update.content,
                expected_head_revision_id=update.expected_head_revision_id,
                review=should_review,
            )
        else:
            assert update.content is not None
            result = container.annotations.save_text(
                project_id,
                asset_id,
                channel,
                update.content,
                language=language,
                expected_head_revision_id=update.expected_head_revision_id,
                review=should_review,
            )
        return result.document


@channels_router.post(
    "/{channel}/confirm", response_model=AnnotationDocument, include_in_schema=False
)
@channels_router.post("/{channel}/review", response_model=AnnotationDocument)
def review_annotation_channel(
    project_id: str,
    asset_id: str,
    channel: AnnotationChannel,
    request: AnnotationReviewRequest,
    container: Container,
    language: str = "",
):
    with container.preprocessing.guard_workspace(
        project_id,
        f"review-annotation:{asset_id}:{channel.value}:{language}",
    ):
        container.asset_deletions.ensure_persisted_inactive(project_id)
        container.exports.ensure_inactive(project_id)
        return container.annotations.review(
            project_id,
            asset_id,
            channel,
            request.expected_head_revision_id,
            language,
        )


@channels_router.delete("/{channel}", response_model=AnnotationDocument)
def delete_annotation_channel(
    project_id: str,
    asset_id: str,
    channel: AnnotationChannel,
    container: Container,
    language: str = "",
):
    with container.preprocessing.guard_workspace(
        project_id,
        f"delete-annotation:{asset_id}:{channel.value}:{language}",
    ):
        container.preprocessing.ensure_persisted_inactive(project_id)
        container.exports.ensure_inactive(project_id)
        container.jobs.ensure_inactive(project_id)
        container.asset_deletions.ensure_persisted_inactive(project_id)
        return container.annotations.delete(project_id, asset_id, channel, language)


@channels_router.get("/{channel}/history", response_model=list[AnnotationRevision])
def annotation_channel_history(
    project_id: str,
    asset_id: str,
    channel: AnnotationChannel,
    container: Container,
    language: str = "",
):
    return container.annotations.history(project_id, asset_id, channel, language)
