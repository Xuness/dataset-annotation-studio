from typing import Annotated

from fastapi import APIRouter, Depends

from dataset_studio.api.container import AppContainer
from dataset_studio.api.dependencies import get_container
from dataset_studio.modules.annotations.models import (
    AnnotationBatchConfirmRequest,
    AnnotationBatchConfirmResult,
    AnnotationBatchDeleteRequest,
    AnnotationBatchDeleteResult,
    AnnotationBundle,
    AnnotationChannel,
    AnnotationChannelUpdate,
    AnnotationConfirmRequest,
    AnnotationDocument,
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


@router.get("", response_model=AnnotationDocument)
def get_annotation(project_id: str, asset_id: str, container: Container):
    return container.annotations.get(project_id, asset_id)


@router.put("", response_model=AnnotationDocument)
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


@router.delete("", response_model=AnnotationDocument)
def delete_annotation(project_id: str, asset_id: str, container: Container):
    with container.preprocessing.guard_workspace(project_id, f"delete-annotation:{asset_id}"):
        container.preprocessing.ensure_persisted_inactive(project_id)
        container.exports.ensure_inactive(project_id)
        container.jobs.ensure_inactive(project_id)
        container.asset_deletions.ensure_persisted_inactive(project_id)
        return container.annotations.delete(project_id, asset_id)


@router.get("/history", response_model=list[AnnotationRevision])
def annotation_history(project_id: str, asset_id: str, container: Container):
    return container.annotations.history(project_id, asset_id)


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
        )


@batch_router.post("/tags/confirm", response_model=AnnotationBatchConfirmResult)
def confirm_tag_annotations(
    project_id: str,
    request: AnnotationBatchConfirmRequest,
    container: Container,
):
    with container.preprocessing.guard_workspace(project_id, "confirm-tags-batch"):
        container.asset_deletions.ensure_persisted_inactive(project_id)
        container.exports.ensure_inactive(project_id)
        return container.annotations.confirm_tags_many(project_id, request.asset_ids)


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
        should_confirm = (
            update.confirm if update.confirm is not None else channel == AnnotationChannel.TAGS
        )
        if update.tags is not None:
            if channel != AnnotationChannel.TAGS:
                raise ValueError("只有 Tags 通道可以保存结构化 Tag。")
            result = container.annotations.save_tags(
                project_id,
                asset_id,
                update.tags,
                expected_head_revision_id=update.expected_head_revision_id,
                confirm=should_confirm,
            )
        elif channel == AnnotationChannel.TRANSLATION:
            assert update.content is not None
            return container.translations.save_manual(
                project_id,
                asset_id,
                language,
                update.content,
                expected_head_revision_id=update.expected_head_revision_id,
                confirm=should_confirm,
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
                confirm=should_confirm,
            )
        return result.document


@channels_router.post("/{channel}/confirm", response_model=AnnotationDocument)
def confirm_annotation_channel(
    project_id: str,
    asset_id: str,
    channel: AnnotationChannel,
    request: AnnotationConfirmRequest,
    container: Container,
    language: str = "",
):
    with container.preprocessing.guard_workspace(
        project_id,
        f"confirm-annotation:{asset_id}:{channel.value}:{language}",
    ):
        container.asset_deletions.ensure_persisted_inactive(project_id)
        container.exports.ensure_inactive(project_id)
        return container.annotations.confirm(
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
