from typing import Annotated

from fastapi import APIRouter, Depends

from dataset_studio.api.container import AppContainer
from dataset_studio.api.dependencies import get_container
from dataset_studio.modules.annotations.models import (
    AnnotationBatchDeleteRequest,
    AnnotationBatchDeleteResult,
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
        return container.annotations.delete_many(project_id, request.asset_ids)
