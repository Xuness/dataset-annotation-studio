from __future__ import annotations

import shutil
import sqlite3
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

from dataset_studio.core.files import atomic_copy_file
from dataset_studio.modules.assets.scanner import AssetScanner
from dataset_studio.modules.preprocessing.image_pipeline import sha256
from dataset_studio.modules.preprocessing.models import PreprocessItemPhase
from dataset_studio.modules.preprocessing.repository import PreprocessRepository
from dataset_studio.modules.workspaces.paths import WorkspacePaths
from dataset_studio.modules.workspaces.service import WorkspaceService


@dataclass(frozen=True, slots=True)
class RecoveryFileOperations:
    same_file: Callable[[Path, Path], bool]
    claimed_annotation_paths: Callable[[Path, Path], set[str]]
    sidecar_paths: Callable[
        [Path, Path, Path, set[str]],
        list[tuple[Path, Path, Path]],
    ]
    update_asset: Callable[[Path, str, Path, Path, str, int, int], None]


class PreprocessRecoveryCoordinator:
    def __init__(
        self,
        workspaces: WorkspaceService,
        scanner: AssetScanner,
        file_operations: RecoveryFileOperations,
    ) -> None:
        self._workspaces = workspaces
        self._scanner = scanner
        self._files = file_operations

    def recover_orphaned(self) -> int:
        recovered = 0
        for workspace in self._workspaces.list_recent():
            if not workspace.exists:
                continue
            paths, manifest = self._workspaces.get(workspace.project_id)
            repository = PreprocessRepository(paths.database)
            for operation_id in repository.claim_orphaned():
                recovered += 1
                try:
                    for item in repository.items(operation_id):
                        if str(item["phase"]) == PreprocessItemPhase.PREPARED.value:
                            continue
                        self._recover_item(paths, item)
                except Exception as error:
                    repository.fail(
                        operation_id,
                        f"上次预处理中断，自动恢复未完全完成：{error}",
                    )
                else:
                    repository.fail(
                        operation_id,
                        "上次预处理在运行期间中断；原文件已自动恢复。",
                    )
                    shutil.rmtree(paths.recovery / operation_id, ignore_errors=True)
                try:
                    self._scanner.scan(paths, manifest)
                except Exception as error:
                    operation = repository.get(operation_id)
                    previous = operation.error_message if operation else "上次预处理中断。"
                    repository.fail(operation_id, f"{previous} 恢复后重新扫描失败：{error}")
        return recovered

    def _recover_item(self, paths: WorkspacePaths, item: sqlite3.Row) -> None:
        before = paths.root / str(item["before_relative_path"])
        after = paths.root / str(item["after_relative_path"])
        recovery = paths.root / str(item["recovery_relative_path"])
        before_hash = str(item["before_hash"])
        after_hash = str(item["after_hash"])
        if not recovery.is_file() or sha256(recovery) != before_hash:
            raise ValueError(f"恢复文件缺失或校验失败：{item['recovery_relative_path']}")

        paths_differ = str(item["before_relative_path"]) != str(item["after_relative_path"])
        same_current_file = paths_differ and self._files.same_file(before, after)
        current_before_hash = sha256(before) if before.is_file() else None
        current_after_hash = (
            current_before_hash if same_current_file else sha256(after) if after.is_file() else None
        )
        expected_current_hashes = {before_hash, after_hash}
        if current_before_hash is not None and current_before_hash not in expected_current_hashes:
            raise ValueError(f"原路径出现未知内容，未自动覆盖：{item['before_relative_path']}")
        if current_after_hash is not None and current_after_hash not in expected_current_hashes:
            raise ValueError(f"目标路径出现未知内容，未自动删除：{item['after_relative_path']}")

        claimed_annotations = self._files.claimed_annotation_paths(paths.database, paths.root)
        sidecars = self._files.sidecar_paths(before, after, recovery, claimed_annotations)
        for before_sidecar, after_sidecar, recovery_sidecar in sidecars:
            self._recover_sidecar(before_sidecar, after_sidecar, recovery_sidecar)

        if paths_differ and after.exists():
            after.unlink()
        atomic_copy_file(recovery, before)
        self._files.update_asset(
            paths.database,
            str(item["asset_id"]),
            before,
            paths.root,
            before_hash,
            int(item["before_width"]),
            int(item["before_height"]),
        )

    def _recover_sidecar(self, before: Path, after: Path, recovery: Path) -> None:
        if not recovery.is_file():
            return
        recovery_hash = sha256(recovery)
        same_current_file = self._files.same_file(before, after)
        before_hash = sha256(before) if before.is_file() else None
        after_hash = (
            before_hash if same_current_file else sha256(after) if after.is_file() else None
        )
        if before_hash is not None and before_hash != recovery_hash:
            raise ValueError(f"原伴随文件出现未知内容，未自动覆盖：{before}")
        if after_hash is not None and after_hash != recovery_hash:
            raise ValueError(f"目标伴随文件出现未知内容，未自动删除：{after}")
        if after.exists():
            after.unlink()
        atomic_copy_file(recovery, before)
