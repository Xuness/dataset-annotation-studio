from __future__ import annotations

import sqlite3
import uuid
from pathlib import Path

from dataset_studio.core.errors import StudioError, WorkspaceNotFoundError
from dataset_studio.modules.assets.repository import AssetRepository
from dataset_studio.modules.screening.models import (
    ScreeningAssetIds,
    ScreeningCandidatePool,
    ScreeningCapabilities,
    ScreeningIntensity,
    ScreeningItem,
    ScreeningItemList,
    ScreeningOperation,
    ScreeningPreview,
    ScreeningRequest,
    ScreeningTaskProfileSelection,
)
from dataset_studio.modules.screening.repository import ScreeningRepository
from dataset_studio.modules.screening.selection_policy import apply_selection_policy
from dataset_studio.modules.screening.task_profiles import evaluate_task_profile
from dataset_studio.modules.workspaces.service import WorkspaceService


class ScreeningNotFoundError(StudioError):
    pass


class ScreeningService:
    def __init__(self, workspaces: WorkspaceService) -> None:
        self._workspaces = workspaces

    @staticmethod
    def capabilities() -> ScreeningCapabilities:
        return ScreeningCapabilities()

    def preview(self, project_id: str, request: ScreeningRequest) -> ScreeningPreview:
        paths, _ = self._workspaces.get(project_id)
        assets = AssetRepository(paths.database).get_assets(request.asset_ids)
        missing = [asset_id for asset_id in request.asset_ids if asset_id not in assets]
        metadata_available = sum(
            1
            for asset in assets.values()
            if asset["metadata_relative_path"] is not None
            and (paths.root / str(asset["metadata_relative_path"])).is_file()
        )
        return ScreeningPreview(
            requested_count=len(request.asset_ids),
            available_count=len(assets),
            metadata_available_count=metadata_available,
            metadata_missing_count=len(assets) - metadata_available,
            missing_asset_ids=missing[:100],
        )

    def create(self, project_id: str, request: ScreeningRequest) -> ScreeningOperation:
        paths, _ = self._workspaces.get(project_id)
        repository = ScreeningRepository(paths.database)
        if repository.active_count():
            raise ValueError("当前项目已有筛选任务正在进行。")
        if len(request.asset_ids) != len(set(request.asset_ids)):
            # Normally handled by the request validator; keep the service
            # invariant explicit for direct/internal callers as well.
            request = request.model_copy(
                update={"asset_ids": list(dict.fromkeys(request.asset_ids))}
            )
        by_id = AssetRepository(paths.database).get_assets(request.asset_ids)
        missing = [asset_id for asset_id in request.asset_ids if asset_id not in by_id]
        if missing:
            raise ValueError(f"有 {len(missing)} 张图片已不在当前工作区，请刷新范围后重试。")
        assets = sorted(
            by_id.values(),
            key=lambda asset: (
                str(asset["metadata_relative_path"] or asset["relative_path"]).casefold(),
                str(asset["id"]),
            ),
        )
        metadata_stats: dict[str, tuple[int, int]] = {}
        try:
            resolved_root = paths.root.resolve()
        except OSError as error:
            raise ValueError(f"无法解析当前工作区路径：{error}") from error
        for asset in assets:
            relative_path = asset["metadata_relative_path"]
            if relative_path is None:
                continue
            unresolved = resolved_root / str(relative_path)
            try:
                path = unresolved.resolve()
            except OSError as error:
                raise ValueError(f"无法冻结元数据文件状态：{relative_path}（{error}）") from error
            if not path.is_relative_to(resolved_root):
                raise ValueError(f"元数据路径超出当前工作区：{relative_path}")
            try:
                if unresolved.is_symlink():
                    raise ValueError(f"同名元数据文件不能是符号链接：{relative_path}")
                if not path.is_file():
                    continue
                stat = path.stat()
            except ValueError:
                raise
            except OSError as error:
                raise ValueError(f"无法冻结元数据文件状态：{relative_path}（{error}）") from error
            metadata_stats[str(asset["id"])] = (stat.st_size, stat.st_mtime_ns)
        operation_id = str(uuid.uuid4())
        repository.create(operation_id, request, assets, metadata_stats)
        self._workspaces.mark_worker_activity(project_id, "screening")
        operation = repository.get(operation_id)
        if operation is None:
            raise RuntimeError("筛选任务创建后无法读取。")
        return operation

    def list(self, project_id: str, *, limit: int) -> list[ScreeningOperation]:
        paths, _ = self._workspaces.get(project_id)
        return ScreeningRepository(paths.database).list(limit=min(max(limit, 1), 500))

    def get(self, project_id: str, operation_id: str) -> ScreeningOperation:
        repository = self._repository(project_id)
        operation = repository.get(operation_id)
        if operation is None:
            raise ScreeningNotFoundError(f"找不到筛选任务：{operation_id}")
        return operation

    def stop(self, project_id: str, operation_id: str) -> ScreeningOperation:
        repository = self._repository(project_id)
        if not repository.request_stop(operation_id):
            raise ScreeningNotFoundError("筛选任务不存在或已经结束。")
        self._workspaces.mark_worker_activity(project_id, "screening")
        return self.get(project_id, operation_id)

    def resume(self, project_id: str, operation_id: str) -> ScreeningOperation:
        repository = self._repository(project_id)
        if not repository.resume(operation_id):
            raise ValueError("只有已停止或意外中断的筛选任务可以继续。")
        self._workspaces.mark_worker_activity(project_id, "screening")
        return self.get(project_id, operation_id)

    def apply_task_profile(
        self,
        project_id: str,
        operation_id: str,
        selection: ScreeningTaskProfileSelection,
    ) -> ScreeningOperation:
        operation = self.get(project_id, operation_id)
        if operation.status != "completed":
            raise ValueError("只有已完成的筛选任务可以切换任务适配预设。")
        repository = self._repository(project_id)
        inputs = repository.task_profile_inputs(operation_id)
        if (
            inputs
            and all(item.task_tags is None for item in inputs)
            and any(selection.task_rules.model_dump().values())
        ):
            raise ValueError("该历史任务没有缓存标签特征，请重新运行一次筛选后再切换预设。")
        intensity = operation.configuration_snapshot.get("intensity", "balanced")
        task_outputs = evaluate_task_profile(inputs, selection.task_rules)
        repository.save_task_profile(
            operation_id,
            selection,
            apply_selection_policy(
                inputs,
                task_outputs,
                intensity=ScreeningIntensity(str(intensity)),
            ),
        )
        return self.get(project_id, operation_id)

    def list_items(
        self,
        project_id: str,
        operation_id: str,
        *,
        offset: int,
        limit: int,
        candidate_pool: ScreeningCandidatePool | None,
        rating: str | None,
        low_resolution: bool | None,
        duplicate_variant: bool | None,
        pixel_duplicate: bool | None,
        danbooru_variant: bool | None,
        show_duplicates: bool,
        sort: str,
    ) -> ScreeningItemList:
        self.get(project_id, operation_id)
        return self._repository(project_id).list_items(
            operation_id,
            offset=offset,
            limit=limit,
            candidate_pool=candidate_pool.value if candidate_pool else None,
            rating=rating,
            low_resolution=low_resolution,
            duplicate_variant=duplicate_variant,
            pixel_duplicate=pixel_duplicate,
            danbooru_variant=danbooru_variant,
            show_duplicates=show_duplicates,
            sort=sort,
        )

    def get_item(self, project_id: str, operation_id: str, asset_id: str) -> ScreeningItem:
        self.get(project_id, operation_id)
        item = self._repository(project_id).get_item(operation_id, asset_id)
        if item is None:
            raise ScreeningNotFoundError(f"筛选任务中找不到素材：{asset_id}")
        return item

    def asset_ids(
        self,
        project_id: str,
        operation_id: str,
        *,
        candidate_pool: ScreeningCandidatePool | None,
        rating: str | None,
        low_resolution: bool | None,
        duplicate_variant: bool | None,
        pixel_duplicate: bool | None,
        danbooru_variant: bool | None,
        show_duplicates: bool,
    ) -> ScreeningAssetIds:
        self.get(project_id, operation_id)
        ids = self._repository(project_id).asset_ids(
            operation_id,
            candidate_pool=candidate_pool.value if candidate_pool else None,
            rating=rating,
            low_resolution=low_resolution,
            duplicate_variant=duplicate_variant,
            pixel_duplicate=pixel_duplicate,
            danbooru_variant=danbooru_variant,
            show_duplicates=show_duplicates,
        )
        return ScreeningAssetIds(ids=ids, total=len(ids))

    def has_active(self, project_id: str) -> bool:
        return self._repository(project_id).active_count() > 0

    @staticmethod
    def has_active_database(database_path: Path) -> bool:
        return ScreeningRepository(database_path).active_count() > 0

    def ensure_inactive(self, project_id: str) -> None:
        if self.has_active(project_id):
            raise ValueError("当前工作区正在筛选图片，请先停止筛选任务。")

    @classmethod
    def ensure_database_inactive(cls, database_path: Path) -> None:
        if cls.has_active_database(database_path):
            raise ValueError("当前工作区正在筛选图片，请先停止筛选任务。")

    def active_project_ids(self) -> set[str]:
        return {project_id for project_id, _ in self._active_workspace_databases()}

    def active_overview(self) -> tuple[int, int]:
        workspaces = self._active_workspace_databases()
        return (
            sum(ScreeningRepository(database).active_count() for _, database in workspaces),
            len(workspaces),
        )

    def stop_all_workspaces(self) -> int:
        stopped = 0
        for project_id, database in self._active_workspace_databases():
            count = ScreeningRepository(database).request_stop_all()
            stopped += count
            if count:
                self._workspaces.mark_worker_activity(project_id, "screening")
        return stopped

    def _active_workspace_databases(self) -> list[tuple[str, Path]]:
        active: list[tuple[str, Path]] = []
        for candidate in self._workspaces.worker_candidates("screening"):
            try:
                paths, _ = self._workspaces.get(candidate.project_id)
                has_active = ScreeningRepository(paths.database).active_count() > 0
            except (WorkspaceNotFoundError, OSError, ValueError, sqlite3.Error):
                self._workspaces.clear_worker_activity(
                    candidate.project_id, "screening", requested_at=candidate.requested_at
                )
                continue
            if has_active:
                active.append((candidate.project_id, paths.database))
            else:
                self._workspaces.clear_worker_activity(
                    candidate.project_id, "screening", requested_at=candidate.requested_at
                )
        return active

    def _repository(self, project_id: str) -> ScreeningRepository:
        paths, _ = self._workspaces.get(project_id)
        return ScreeningRepository(paths.database)
