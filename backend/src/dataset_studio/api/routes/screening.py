from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Query

from dataset_studio.api.container import AppContainer
from dataset_studio.api.dependencies import get_container
from dataset_studio.modules.screening.models import (
    ScreeningAssetIds,
    ScreeningCandidatePool,
    ScreeningCapabilities,
    ScreeningItem,
    ScreeningItemList,
    ScreeningOperation,
    ScreeningPreview,
    ScreeningRequest,
    ScreeningTaskProfileSelection,
)

router = APIRouter(prefix="/workspaces/{project_id}/screening", tags=["screening"])
Container = Annotated[AppContainer, Depends(get_container)]
Rating = Literal["g", "s", "q", "e"]
ItemSort = Literal["selection", "priority", "percentile", "score", "path"]


@router.get("/capabilities", response_model=ScreeningCapabilities)
def screening_capabilities(project_id: str, container: Container):
    container.workspaces.get(project_id)
    return container.screening.capabilities()


@router.post("/preview", response_model=ScreeningPreview)
def preview_screening(project_id: str, request: ScreeningRequest, container: Container):
    return container.screening.preview(project_id, request)


@router.post("/operations", response_model=ScreeningOperation, status_code=201)
def create_screening(project_id: str, request: ScreeningRequest, container: Container):
    with container.preprocessing.guard_workspace(project_id, "create-screening"):
        container.exports.ensure_inactive(project_id)
        container.jobs.ensure_inactive(project_id)
        container.asset_deletions.ensure_persisted_inactive(project_id)
        return container.screening.create(project_id, request)


@router.get("/operations", response_model=list[ScreeningOperation])
def list_screening_operations(
    project_id: str,
    container: Container,
    limit: int = Query(default=100, ge=1, le=500),
):
    return container.screening.list(project_id, limit=limit)


@router.get("/operations/{operation_id}", response_model=ScreeningOperation)
def get_screening_operation(project_id: str, operation_id: str, container: Container):
    return container.screening.get(project_id, operation_id)


@router.post("/operations/{operation_id}/stop", response_model=ScreeningOperation)
def stop_screening_operation(project_id: str, operation_id: str, container: Container):
    return container.screening.stop(project_id, operation_id)


@router.post("/operations/{operation_id}/resume", response_model=ScreeningOperation)
def resume_screening_operation(project_id: str, operation_id: str, container: Container):
    with container.preprocessing.guard_workspace(project_id, f"resume-screening:{operation_id}"):
        container.exports.ensure_inactive(project_id)
        container.jobs.ensure_inactive(project_id)
        container.asset_deletions.ensure_persisted_inactive(project_id)
        return container.screening.resume(project_id, operation_id)


@router.put("/operations/{operation_id}/task-profile", response_model=ScreeningOperation)
def apply_screening_task_profile(
    project_id: str,
    operation_id: str,
    request: ScreeningTaskProfileSelection,
    container: Container,
):
    return container.screening.apply_task_profile(project_id, operation_id, request)


@router.get("/operations/{operation_id}/items", response_model=ScreeningItemList)
def list_screening_items(
    project_id: str,
    operation_id: str,
    container: Container,
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=200, ge=1, le=1000),
    pool: ScreeningCandidatePool | None = None,
    rating: Rating | None = None,
    low_resolution: bool | None = None,
    duplicate_variant: bool | None = None,
    pixel_duplicate: bool | None = None,
    danbooru_variant: bool | None = None,
    show_duplicates: bool = False,
    sort: ItemSort = "selection",
):
    return container.screening.list_items(
        project_id,
        operation_id,
        offset=offset,
        limit=limit,
        candidate_pool=pool,
        rating=rating,
        low_resolution=low_resolution,
        duplicate_variant=duplicate_variant,
        pixel_duplicate=pixel_duplicate,
        danbooru_variant=danbooru_variant,
        show_duplicates=show_duplicates,
        sort=sort,
    )


@router.get("/operations/{operation_id}/items/{asset_id}", response_model=ScreeningItem)
def get_screening_item(
    project_id: str,
    operation_id: str,
    asset_id: str,
    container: Container,
):
    return container.screening.get_item(project_id, operation_id, asset_id)


@router.get("/operations/{operation_id}/asset-ids", response_model=ScreeningAssetIds)
def screening_asset_ids(
    project_id: str,
    operation_id: str,
    container: Container,
    pool: ScreeningCandidatePool | None = None,
    rating: Rating | None = None,
    low_resolution: bool | None = None,
    duplicate_variant: bool | None = None,
    pixel_duplicate: bool | None = None,
    danbooru_variant: bool | None = None,
    show_duplicates: bool = False,
):
    return container.screening.asset_ids(
        project_id,
        operation_id,
        candidate_pool=pool,
        rating=rating,
        low_resolution=low_resolution,
        duplicate_variant=duplicate_variant,
        pixel_duplicate=pixel_duplicate,
        danbooru_variant=danbooru_variant,
        show_duplicates=show_duplicates,
    )
