from __future__ import annotations

import secrets
import sqlite3
import uuid
from collections.abc import Callable
from pathlib import Path

from dataset_studio.core.errors import StudioError, WorkspaceNotFoundError
from dataset_studio.modules.exports.models import (
    ExportCreateRequest,
    ExportOperation,
    ExportOperationStatus,
    ExportPreview,
    ExportRequest,
    ExportScope,
)
from dataset_studio.modules.exports.planner import ExportPlan, build_plan, preview_token, to_preview
from dataset_studio.modules.exports.repository import ExportRepository
from dataset_studio.modules.workspaces.models import WorkspaceSettingsUpdate
from dataset_studio.modules.workspaces.service import WorkspaceService


class ExportNotFoundError(StudioError):
    pass


class ExportService:
    def __init__(
        self,
        workspaces: WorkspaceService,
        *,
        has_active_jobs: Callable[[str], bool] | None = None,
        has_active_preprocessing: Callable[[str], bool] | None = None,
        has_active_asset_deletions: Callable[[str], bool] | None = None,
    ) -> None:
        self._workspaces = workspaces
        self._has_active_jobs = has_active_jobs or (lambda _project_id: False)
        self._has_active_preprocessing = has_active_preprocessing or (lambda _project_id: False)
        self._has_active_asset_deletions = has_active_asset_deletions or (lambda _project_id: False)

    def set_activity_checks(
        self,
        *,
        has_active_jobs: Callable[[str], bool],
        has_active_preprocessing: Callable[[str], bool],
        has_active_asset_deletions: Callable[[str], bool],
    ) -> None:
        self._has_active_jobs = has_active_jobs
        self._has_active_preprocessing = has_active_preprocessing
        self._has_active_asset_deletions = has_active_asset_deletions

    def preview(self, project_id: str, request: ExportRequest) -> ExportPreview:
        paths, _ = self._workspaces.get(project_id)
        self._validate_storage_target(request)
        plan = build_plan(paths.database, paths.root, request)
        self._validate_storage_plan(request, plan)
        return to_preview(request, plan)

    def create(
        self,
        project_id: str,
        execution: ExportCreateRequest,
    ) -> ExportOperation:
        self._ensure_can_start(project_id)
        paths, _ = self._workspaces.get(project_id)
        self._validate_storage_target(execution.request)
        plan = build_plan(paths.database, paths.root, execution.request)
        self._validate_storage_plan(execution.request, plan)
        current_token = preview_token(execution.request, plan)
        if not secrets.compare_digest(current_token, execution.preview_token):
            raise ValueError("导出预览已失效；范围、源文件或目标目录发生了变化，请重新校验。")
        item_blocking_issue = next(
            (item.blocking_issue for item in plan.items if item.blocking_issue),
            None,
        )
        if plan.blocking_issues or item_blocking_issue:
            issue = plan.blocking_issues[0] if plan.blocking_issues else item_blocking_issue
            raise ValueError(issue or "导出计划存在无法绕过的问题。")
        warning_count = sum(item.warning_code is not None for item in plan.items)
        if warning_count and not execution.allow_warnings:
            raise ValueError(
                f"导出范围中仍有 {warning_count} 个标注警告；请返回检查，或明确允许强制导出。"
            )

        operation_id = str(uuid.uuid4())
        repository = ExportRepository(paths.database)
        repository.create(
            operation_id,
            execution.request,
            plan,
            allow_warnings=execution.allow_warnings,
        )
        operation = repository.get(operation_id)
        if operation is None:
            raise RuntimeError("导出任务创建后无法读取。")
        self._workspaces.update_settings(
            project_id,
            WorkspaceSettingsUpdate(
                export_preferences=execution.request.model_copy(
                    update={"conflict_policy": "block", "scope": ExportScope.ALL, "asset_ids": []}
                )
            ),
        )
        self._workspaces.mark_worker_activity(project_id, "exports")
        return operation

    def _validate_storage_plan(self, request: ExportRequest, plan: ExportPlan) -> None:
        if request.packaging == "zip":
            return
        app_data = self._workspaces.settings.app_data_dir.resolve()
        for item in plan.items:
            for artifact in item.artifacts:
                target = (Path(plan.destination_path) / artifact.target_relative_path).resolve()
                if target.is_relative_to(app_data) or ".annotation-workspace" in target.parts:
                    raise ValueError(f"导出产物不能写入工具数据目录或旧工作区备份：{target}")

    def _validate_storage_target(self, request: ExportRequest) -> None:
        if request.destination_kind == "directory":
            target = Path(request.destination_path).expanduser().resolve()
            if target.is_relative_to(self._workspaces.settings.app_data_dir):
                raise ValueError("不能导出到工具数据目录。")

    def list(self, project_id: str, *, limit: int = 100) -> list[ExportOperation]:
        paths, _ = self._workspaces.get(project_id)
        return ExportRepository(paths.database).list(limit=min(max(limit, 1), 500))

    def get(self, project_id: str, operation_id: str) -> ExportOperation:
        paths, _ = self._workspaces.get(project_id)
        operation = ExportRepository(paths.database).get(operation_id)
        if operation is None:
            raise ExportNotFoundError(f"找不到导出任务：{operation_id}")
        return operation

    def stop(self, project_id: str, operation_id: str) -> ExportOperation:
        paths, _ = self._workspaces.get(project_id)
        repository = ExportRepository(paths.database)
        if not repository.request_stop(operation_id):
            raise ExportNotFoundError("导出任务不存在或已经结束。")
        operation = repository.get(operation_id)
        if operation is None:
            raise ExportNotFoundError(f"找不到导出任务：{operation_id}")
        self._workspaces.mark_worker_activity(project_id, "exports")
        return operation

    def resume(self, project_id: str, operation_id: str) -> ExportOperation:
        self._ensure_can_start(project_id)
        paths, _ = self._workspaces.get(project_id)
        repository = ExportRepository(paths.database)
        if not repository.resume(operation_id):
            raise ValueError("只有已停止或意外中断的导出任务可以继续。")
        operation = repository.get(operation_id)
        if operation is None:
            raise ExportNotFoundError(f"找不到导出任务：{operation_id}")
        self._workspaces.mark_worker_activity(project_id, "exports")
        return operation

    def has_active(self, project_id: str) -> bool:
        paths, _ = self._workspaces.get(project_id)
        return ExportRepository(paths.database).active_count() > 0

    def ensure_inactive(self, project_id: str) -> None:
        if self.has_active(project_id):
            raise ValueError("当前工作区正在导出数据，请先停止导出任务。")

    @staticmethod
    def has_active_database(database_path: Path) -> bool:
        return ExportRepository(database_path).active_count() > 0

    @classmethod
    def ensure_database_inactive(cls, database_path: Path) -> None:
        if cls.has_active_database(database_path):
            raise ValueError("当前工作区正在导出数据，请先停止导出任务。")

    def active_project_ids(self) -> set[str]:
        return {project_id for project_id, _database in self._active_workspace_databases()}

    def active_overview(self) -> tuple[int, int]:
        active_workspaces = self._active_workspace_databases()
        count = sum(
            ExportRepository(database).active_count() for _project_id, database in active_workspaces
        )
        return count, len(active_workspaces)

    def stop_all_workspaces(self) -> int:
        stopped = 0
        for project_id, database in self._active_workspace_databases():
            project_stopped = ExportRepository(database).request_stop_all()
            stopped += project_stopped
            if project_stopped:
                self._workspaces.mark_worker_activity(project_id, "exports")
        return stopped

    def _active_workspace_databases(self) -> list[tuple[str, Path]]:
        active: list[tuple[str, Path]] = []
        for candidate in self._workspaces.worker_candidates("exports"):
            try:
                paths, _ = self._workspaces.get(candidate.project_id)
                has_active = ExportRepository(paths.database).active_count() > 0
            except (WorkspaceNotFoundError, OSError, ValueError, sqlite3.Error):
                self._workspaces.clear_worker_activity(
                    candidate.project_id,
                    "exports",
                    requested_at=candidate.requested_at,
                )
                continue
            if has_active:
                active.append((candidate.project_id, paths.database))
            else:
                self._workspaces.clear_worker_activity(
                    candidate.project_id,
                    "exports",
                    requested_at=candidate.requested_at,
                )
        return active

    def _ensure_can_start(self, project_id: str) -> None:
        if self._has_active_preprocessing(project_id):
            raise ValueError("当前工作区正在扫描或预处理图片，请等待操作完成。")
        if self._has_active_jobs(project_id):
            raise ValueError("当前工作区仍有标注或翻译任务运行，请先停止任务再导出。")
        if self._has_active_asset_deletions(project_id):
            raise ValueError("当前工作区正在删除或恢复素材，请等待操作完成。")
        if self.has_active(project_id):
            raise ValueError("当前项目已有导出任务正在进行。")

    @staticmethod
    def is_active_status(status: ExportOperationStatus) -> bool:
        return status in {
            ExportOperationStatus.QUEUED,
            ExportOperationStatus.RUNNING,
            ExportOperationStatus.STOPPING,
        }
