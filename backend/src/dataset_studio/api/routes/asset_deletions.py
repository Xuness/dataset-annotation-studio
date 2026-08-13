from typing import Annotated

from fastapi import APIRouter, Depends, Query

from dataset_studio.api.container import AppContainer
from dataset_studio.api.dependencies import get_container
from dataset_studio.modules.assets.deletions.models import (
    AssetDeleteOperation,
    AssetDeletionExecuteRequest,
    AssetDeletionPreview,
    AssetDeletionRequest,
)

router = APIRouter(
    prefix="/workspaces/{project_id}/asset-deletions",
    tags=["asset-deletions"],
)
Container = Annotated[AppContainer, Depends(get_container)]


@router.post("/preview", response_model=AssetDeletionPreview)
def preview_deletion(
    project_id: str,
    request: AssetDeletionRequest,
    container: Container,
):
    return container.asset_deletions.preview(project_id, request)


@router.post("/execute", response_model=AssetDeleteOperation)
def execute_deletion(
    project_id: str,
    execution: AssetDeletionExecuteRequest,
    container: Container,
):
    with container.preprocessing.guard_workspace(project_id, "delete-assets"):
        container.preprocessing.ensure_persisted_inactive(project_id)
        container.exports.ensure_inactive(project_id)
        container.jobs.ensure_inactive(project_id)
        container.asset_deletions.ensure_persisted_inactive(project_id)
        container.screening.ensure_inactive(project_id)
        return container.asset_deletions.execute(project_id, execution)


@router.get("/operations", response_model=list[AssetDeleteOperation])
def list_deletions(
    project_id: str,
    container: Container,
    limit: int = Query(default=50, ge=1, le=200),
):
    return container.asset_deletions.list_operations(project_id, limit)


@router.post(
    "/operations/{operation_id}/undo",
    response_model=AssetDeleteOperation,
)
def undo_deletion(
    project_id: str,
    operation_id: str,
    container: Container,
):
    with container.preprocessing.guard_workspace(
        project_id,
        f"undo-asset-deletion:{operation_id}",
    ):
        container.preprocessing.ensure_persisted_inactive(project_id)
        container.exports.ensure_inactive(project_id)
        container.jobs.ensure_inactive(project_id)
        container.asset_deletions.ensure_persisted_inactive(project_id)
        container.screening.ensure_inactive(project_id)
        return container.asset_deletions.undo(project_id, operation_id)
