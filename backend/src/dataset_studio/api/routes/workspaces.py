from contextlib import contextmanager
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Depends, Response, status
from filelock import FileLock

from dataset_studio.api.container import AppContainer
from dataset_studio.api.dependencies import get_container
from dataset_studio.core.errors import WorkspaceNotFoundError
from dataset_studio.core.file_targets import hold_file_targets
from dataset_studio.modules.workspaces.association import (
    RelocateExecution,
    RelocatePreview,
    RelocateRequest,
    detach,
    preview_relocation,
    relocate,
)
from dataset_studio.modules.workspaces.backups import (
    OriginalFile,
    RestoreExecution,
    RestorePreview,
    RestoreRequest,
    list_originals,
    restore_files,
    restore_preview,
)
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
            container.screening.ensure_inactive(project_id)
        else:
            container.preprocessing.ensure_database_inactive(database_path)
            container.exports.ensure_database_inactive(database_path)
            container.jobs.ensure_database_inactive(database_path)
            container.asset_deletions.ensure_database_inactive(database_path)
            container.screening.ensure_database_inactive(database_path)
        yield


@contextmanager
def _open_scan_guard(container: AppContainer, project_id: str, database_path: Path):
    with container.preprocessing.guard_workspace(project_id, "open-scan"):
        active = (
            container.preprocessing.has_active_database(database_path)
            or container.exports.has_active_database(database_path)
            or container.jobs.has_active_database(database_path)
            or container.asset_deletions.has_active_database(database_path)
            or container.screening.has_active_database(database_path)
        )
        yield not active


@router.get("", response_model=list[WorkspaceSummary])
def list_workspaces(container: Container):
    return container.workspaces.list_recent()


@router.post("/open", response_model=WorkspaceOpenResponse)
def open_workspace(request: WorkspaceOpenRequest, container: Container):
    workspace, scan = container.workspaces.open(
        request.path,
        independent_copy=request.independent_copy,
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


@router.get("/{project_id}/originals", response_model=list[OriginalFile])
def original_files(project_id: str, container: Container):
    paths = container.workspaces.stored_paths(project_id)
    if not paths.database.is_file():
        paths, _ = container.workspaces.get(project_id)
    return list_originals(paths)


@router.post("/{project_id}/restore/preview", response_model=RestorePreview)
def preview_restore(project_id: str, request: RestoreRequest, container: Container):
    return restore_preview(container.workspaces.stored_paths(project_id), request)


@router.post("/{project_id}/restore", response_model=str)
def execute_restore(project_id: str, execution: RestoreExecution, container: Container):
    paths = container.workspaces.stored_paths(project_id)
    if execution.request.destination_kind == "source":
        paths, _ = container.workspaces.get(project_id)
    with _scan_guard(container, project_id, "restore-originals", database_path=paths.database):
        preview = restore_preview(paths, execution.request)
        with hold_file_targets(
            container.settings.app_data_dir, [Path(item.target_path) for item in preview.items]
        ):
            operation_id = restore_files(paths, execution)
        if execution.request.destination_kind == "source":
            try:
                container.workspaces.rescan(project_id)
            except Exception as error:
                from dataset_studio.core.sqlite import transaction

                with transaction(paths.database) as connection:
                    connection.execute(
                        "UPDATE file_restore_operations SET status='index_failed',error_message=? "
                        "WHERE id=?",
                        (str(error), operation_id),
                    )
                raise RuntimeError(
                    f"文件已恢复，但素材索引更新失败，请重新扫描项目；"
                    f"恢复记录 {operation_id}：{error}"
                ) from error
        return operation_id


@router.post("/{project_id}/relocate/preview", response_model=RelocatePreview)
def preview_relocate(project_id: str, request: RelocateRequest, container: Container):
    return preview_relocation(container.workspaces, project_id, request)


@router.post("/{project_id}/relocate", status_code=204)
def execute_relocate(project_id: str, execution: RelocateExecution, container: Container):
    paths = container.workspaces.stored_paths(project_id)
    with (
        FileLock(container.settings.app_data_dir / "workspace-registration.lock"),
        _scan_guard(container, project_id, "relocate", database_path=paths.database),
    ):
        relocate(container.workspaces, project_id, execution)
    return Response(status_code=204)


@router.post("/{project_id}/detach", status_code=204)
def detach_workspace(project_id: str, container: Container):
    paths = container.workspaces.stored_paths(project_id)
    with (
        FileLock(container.settings.app_data_dir / "workspace-registration.lock"),
        _scan_guard(container, project_id, "detach", database_path=paths.database),
    ):
        detach(container.workspaces, project_id)
    return Response(status_code=204)
