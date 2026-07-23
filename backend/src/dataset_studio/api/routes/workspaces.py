from contextlib import contextmanager
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Depends, Response, status

from dataset_studio.api.container import AppContainer
from dataset_studio.api.dependencies import get_container
from dataset_studio.core.errors import WorkspaceNotFoundError
from dataset_studio.modules.workspaces.models import (
    ScanResult,
    WorkspaceOpenRequest,
    WorkspaceOpenResponse,
    WorkspaceSettingsUpdate,
    WorkspaceSummary,
)

router = APIRouter(prefix="/workspaces", tags=["workspaces"])
Container = Annotated[AppContainer, Depends(get_container)]


@contextmanager
def _scan_guard(
    container: AppContainer,
    project_id: str,
    operation_id: str,
    *,
    database_path: Path | None = None,
):
    with container.preprocessing.guard_workspace(project_id, operation_id):
        if database_path is None:
            container.preprocessing.ensure_persisted_inactive(project_id)
            container.exports.ensure_inactive(project_id)
            container.jobs.ensure_inactive(project_id)
            container.asset_deletions.ensure_persisted_inactive(project_id)
        else:
            container.preprocessing.ensure_database_inactive(database_path)
            container.exports.ensure_database_inactive(database_path)
            container.jobs.ensure_database_inactive(database_path)
            container.asset_deletions.ensure_database_inactive(database_path)
        yield


@contextmanager
def _open_scan_guard(container: AppContainer, project_id: str, database_path: Path):
    with container.preprocessing.guard_workspace(project_id, "open-scan"):
        active = (
            container.preprocessing.has_active_database(database_path)
            or container.exports.has_active_database(database_path)
            or container.jobs.has_active_database(database_path)
            or container.asset_deletions.has_active_database(database_path)
        )
        yield not active


@router.get("", response_model=list[WorkspaceSummary])
def list_workspaces(container: Container):
    return container.workspaces.list_recent()


@router.post("/open", response_model=WorkspaceOpenResponse)
def open_workspace(request: WorkspaceOpenRequest, container: Container):
    workspace, scan = container.workspaces.open(
        request.path,
        scan_guard=lambda project_id, database_path: _open_scan_guard(
            container, project_id, database_path
        ),
    )
    return WorkspaceOpenResponse(workspace=workspace, scan=scan)


@router.get("/{project_id}", response_model=WorkspaceSummary)
def get_workspace(project_id: str, container: Container):
    return container.workspaces.get_summary(project_id)


@router.delete("/{project_id}/recent", status_code=status.HTTP_204_NO_CONTENT)
def remove_recent_workspace(project_id: str, container: Container):
    if container.workspaces.recent_path(project_id) is None:
        raise WorkspaceNotFoundError(f"最近项目中找不到工作区：{project_id}")

    try:
        paths, _ = container.workspaces.get(project_id)
    except (WorkspaceNotFoundError, OSError, ValueError):
        container.workspaces.remove_recent(project_id)
        return Response(status_code=status.HTTP_204_NO_CONTENT)

    with _scan_guard(
        container,
        project_id,
        "remove-recent",
        database_path=paths.database,
    ):
        container.workspaces.remove_recent(project_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.patch("/{project_id}", response_model=WorkspaceSummary)
def update_workspace(project_id: str, update: WorkspaceSettingsUpdate, container: Container):
    if update.system_preset_id is not None:
        container.presets.get_system(update.system_preset_id)
    if update.recursive_scan is None:
        return container.workspaces.update_settings(project_id, update)
    with _scan_guard(container, project_id, "settings-scan"):
        return container.workspaces.update_settings(project_id, update)


@router.post("/{project_id}/scan", response_model=ScanResult)
def scan_workspace(project_id: str, container: Container):
    with _scan_guard(container, project_id, "manual-scan"):
        _, scan = container.workspaces.rescan(project_id)
        return scan
