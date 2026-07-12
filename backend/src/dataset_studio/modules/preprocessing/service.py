from __future__ import annotations

import shutil
import uuid
from dataclasses import asdict
from pathlib import Path

from dataset_studio.core.sqlite import transaction
from dataset_studio.modules.assets.scanner import AssetScanner
from dataset_studio.modules.preprocessing.image_pipeline import render_image, sha256
from dataset_studio.modules.preprocessing.models import (
    PreprocessOperation,
    PreprocessPreview,
    PreprocessPreviewItem,
    PreprocessRequest,
)
from dataset_studio.modules.preprocessing.planner import PlanItem, build_plan
from dataset_studio.modules.preprocessing.repository import PreprocessRepository
from dataset_studio.modules.workspaces.service import WorkspaceService


class PreprocessService:
    def __init__(self, workspaces: WorkspaceService) -> None:
        self._workspaces = workspaces
        self._scanner = AssetScanner()

    def preview(self, project_id: str, request: PreprocessRequest) -> PreprocessPreview:
        paths, _ = self._workspaces.get(project_id)
        plan = build_plan(paths.database, paths.root, request)
        return PreprocessPreview(
            items=[PreprocessPreviewItem(**asdict(item)) for item in plan],
            changed_count=sum(item.will_change for item in plan),
            unchanged_count=sum(not item.will_change for item in plan),
            warning_count=sum(item.warning is not None for item in plan),
        )

    def execute(self, project_id: str, request: PreprocessRequest) -> PreprocessOperation:
        paths, manifest = self._workspaces.get(project_id)
        plan = build_plan(paths.database, paths.root, request)
        warning = next((item.warning for item in plan if item.warning), None)
        if warning:
            raise ValueError(warning)

        operation_id = str(uuid.uuid4())
        repository = PreprocessRepository(paths.database)
        repository.start(operation_id, request)
        completed: list[tuple[PlanItem, Path]] = []
        try:
            for item in plan:
                if item.will_change:
                    recovery = self._execute_item(paths, operation_id, item, request)
                    completed.append((item, recovery))
                    self._record_item(repository, paths.root, operation_id, item, recovery)
            repository.complete(operation_id)
            self._scanner.scan(paths, manifest)
        except Exception as error:
            self._rollback(paths.root, paths.database, completed)
            repository.fail(operation_id, str(error))
            self._scanner.scan(paths, manifest)
            raise
        operation = repository.get(operation_id)
        if operation is None:
            raise RuntimeError("预处理操作记录创建失败。")
        return operation

    def list_operations(self, project_id: str) -> list[PreprocessOperation]:
        paths, _ = self._workspaces.get(project_id)
        return PreprocessRepository(paths.database).list()

    def undo(self, project_id: str, operation_id: str) -> PreprocessOperation:
        paths, manifest = self._workspaces.get(project_id)
        repository = PreprocessRepository(paths.database)
        operation = repository.get(operation_id)
        if operation is None:
            raise ValueError("找不到预处理操作。")
        if operation.status != "completed":
            raise ValueError("只有已完成且尚未撤销的操作可以恢复。")
        if repository.latest_completed_id() != operation_id:
            raise ValueError("只能从最新的一次预处理开始依次撤销。")
        items = list(repository.items(operation_id))
        self._verify_undo(paths.root, items)
        for item in items:
            current = paths.root / str(item["after_relative_path"])
            before = paths.root / str(item["before_relative_path"])
            original = paths.root / str(item["recovery_relative_path"])
            current.unlink()
            before.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(original, before)
            self._update_asset(
                paths.database,
                str(item["asset_id"]),
                before,
                paths.root,
                str(item["before_hash"]),
                int(item["before_width"]),
                int(item["before_height"]),
            )
        repository.mark_undone(operation_id)
        self._scanner.scan(paths, manifest)
        updated = repository.get(operation_id)
        if updated is None:
            raise RuntimeError("预处理操作记录丢失。")
        return updated

    def _execute_item(self, paths, operation_id, item, request) -> Path:
        source = paths.root / item.before_relative_path
        target = paths.root / item.after_relative_path
        recovery = paths.recovery / operation_id / "files" / Path(item.before_relative_path)
        recovery.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, recovery)
        try:
            render_image(source, target, item, request.convert)
            self._update_asset(
                paths.database,
                item.asset_id,
                target,
                paths.root,
                sha256(target),
                item.after_width,
                item.after_height,
            )
        except BaseException:
            self._restore_file(source, target, recovery)
            raise
        return recovery

    @staticmethod
    def _record_item(repository, root, operation_id, item, recovery) -> None:
        target = root / item.after_relative_path
        repository.add_item(
            operation_id,
            (
                str(uuid.uuid4()),
                operation_id,
                item.asset_id,
                item.before_relative_path,
                item.after_relative_path,
                item.before_hash,
                sha256(target),
                item.before_width,
                item.before_height,
                item.after_width,
                item.after_height,
                recovery.relative_to(root).as_posix(),
            ),
        )

    @staticmethod
    def _verify_undo(root: Path, items) -> None:
        for item in items:
            current = root / str(item["after_relative_path"])
            original = root / str(item["recovery_relative_path"])
            if not current.is_file() or sha256(current) != str(item["after_hash"]):
                raise ValueError(
                    f"当前文件已在预处理后被修改，无法安全撤销：{item['after_relative_path']}"
                )
            if not original.is_file():
                raise ValueError(f"恢复文件缺失：{item['recovery_relative_path']}")

    @staticmethod
    def _update_asset(
        database_path: Path,
        asset_id: str,
        image_path: Path,
        root: Path,
        content_hash: str,
        width: int,
        height: int,
    ) -> None:
        stat = image_path.stat()
        annotation = image_path.with_suffix(".txt")
        metadata = image_path.with_suffix(".json")
        with transaction(database_path) as connection:
            connection.execute(
                """
                UPDATE assets
                SET relative_path = ?, filename = ?, stem = ?, suffix = ?,
                    content_hash = ?, byte_size = ?, modified_ns = ?, width = ?, height = ?,
                    annotation_relative_path = ?, metadata_relative_path = ?, is_present = 1
                WHERE id = ?
                """,
                (
                    image_path.relative_to(root).as_posix(),
                    image_path.name,
                    image_path.stem,
                    image_path.suffix.lower(),
                    content_hash,
                    stat.st_size,
                    stat.st_mtime_ns,
                    width,
                    height,
                    annotation.relative_to(root).as_posix(),
                    metadata.relative_to(root).as_posix() if metadata.is_file() else None,
                    asset_id,
                ),
            )

    @classmethod
    def _rollback(
        cls,
        root: Path,
        database_path: Path,
        completed: list[tuple[PlanItem, Path]],
    ) -> None:
        for item, recovery in reversed(completed):
            after = root / item.after_relative_path
            before = root / item.before_relative_path
            cls._restore_file(before, after, recovery)
            cls._update_asset(
                database_path,
                item.asset_id,
                before,
                root,
                item.before_hash,
                item.before_width,
                item.before_height,
            )

    @staticmethod
    def _restore_file(before: Path, after: Path, recovery: Path) -> None:
        if before.resolve() != after.resolve():
            after.unlink(missing_ok=True)
        before.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(recovery, before)
