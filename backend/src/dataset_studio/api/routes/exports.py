from typing import Annotated

from fastapi import APIRouter, Depends, Query

from dataset_studio.api.container import AppContainer
from dataset_studio.api.dependencies import get_container
from dataset_studio.modules.exports.models import (
    ExportCreateRequest,
    ExportOperation,
    ExportPreview,
    ExportRequest,
)

router = APIRouter(prefix="/workspaces/{project_id}/exports", tags=["exports"])
Container = Annotated[AppContainer, Depends(get_container)]


@router.post("/preview", response_model=ExportPreview)
def preview_export(project_id: str, request: ExportRequest, container: Container):
    return container.exports.preview(project_id, request)


@router.post("", response_model=ExportOperation, status_code=201)
def create_export(
    project_id: str,
    execution: ExportCreateRequest,
    container: Container,
):
    with container.preprocessing.guard_workspace(project_id, "create-export"):
        return container.exports.create(project_id, execution)


@router.get("", response_model=list[ExportOperation])
def list_exports(
    project_id: str,
    container: Container,
    limit: int = Query(default=100, ge=1, le=500),
):
    return container.exports.list(project_id, limit=limit)


@router.get("/{operation_id}", response_model=ExportOperation)
def get_export(project_id: str, operation_id: str, container: Container):
    return container.exports.get(project_id, operation_id)


@router.post("/{operation_id}/stop", response_model=ExportOperation)
def stop_export(project_id: str, operation_id: str, container: Container):
    return container.exports.stop(project_id, operation_id)


@router.post("/{operation_id}/resume", response_model=ExportOperation)
def resume_export(project_id: str, operation_id: str, container: Container):
    with container.preprocessing.guard_workspace(project_id, f"resume-export:{operation_id}"):
        return container.exports.resume(project_id, operation_id)
