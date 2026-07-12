from typing import Annotated

from fastapi import APIRouter, Depends

from dataset_studio.api.container import AppContainer
from dataset_studio.api.dependencies import get_container
from dataset_studio.modules.workspaces.models import (
    ScanResult,
    WorkspaceOpenRequest,
    WorkspaceOpenResponse,
    WorkspaceSettingsUpdate,
    WorkspaceSummary,
)

router = APIRouter(prefix="/workspaces", tags=["workspaces"])
Container = Annotated[AppContainer, Depends(get_container)]


@router.get("", response_model=list[WorkspaceSummary])
def list_workspaces(container: Container):
    return container.workspaces.list_recent()


@router.post("/open", response_model=WorkspaceOpenResponse)
def open_workspace(request: WorkspaceOpenRequest, container: Container):
    workspace, scan = container.workspaces.open(request.path)
    return WorkspaceOpenResponse(workspace=workspace, scan=scan)


@router.get("/{project_id}", response_model=WorkspaceSummary)
def get_workspace(project_id: str, container: Container):
    return container.workspaces.get_summary(project_id)


@router.patch("/{project_id}", response_model=WorkspaceSummary)
def update_workspace(project_id: str, update: WorkspaceSettingsUpdate, container: Container):
    return container.workspaces.update_settings(project_id, update)


@router.post("/{project_id}/scan", response_model=ScanResult)
def scan_workspace(project_id: str, container: Container):
    _, scan = container.workspaces.rescan(project_id)
    return scan
