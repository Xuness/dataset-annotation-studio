from __future__ import annotations

import json
import threading
import uuid
from collections.abc import Callable
from contextlib import AbstractContextManager, nullcontext
from pathlib import Path

from dataset_studio.core.config import Settings
from dataset_studio.core.errors import WorkspaceNotFoundError
from dataset_studio.core.files import atomic_write_text
from dataset_studio.core.time import utc_now_iso
from dataset_studio.modules.annotations.legacy_import import ensure_database_annotation_store
from dataset_studio.modules.assets.repository import AssetRepository
from dataset_studio.modules.assets.scanner import AssetScanner
from dataset_studio.modules.output_resources import recover_stale_operation_leases
from dataset_studio.modules.workspaces.models import (
    ScanResult,
    WorkspaceManifest,
    WorkspaceSettingsUpdate,
    WorkspaceSummary,
)
from dataset_studio.modules.workspaces.paths import WorkspacePaths
from dataset_studio.modules.workspaces.repository import (
    WorkerActivityKind,
    WorkerWorkspaceCandidate,
    WorkspaceRegistry,
)
from dataset_studio.modules.workspaces.schema import initialize_workspace_database


class WorkspaceService:
    def __init__(
        self,
        settings: Settings,
        registry: WorkspaceRegistry,
        scanner: AssetScanner | None = None,
    ) -> None:
        self._settings = settings
        self._registry = registry
        self._scanner = scanner or AssetScanner()
        self._initialized_databases: set[Path] = set()
        self._database_init_lock = threading.Lock()

    def open(
        self,
        raw_path: str,
        *,
        scan_guard: Callable[[str, Path], AbstractContextManager[bool | None]] | None = None,
    ) -> tuple[WorkspaceSummary, ScanResult]:
        root = Path(raw_path).expanduser().resolve()
        if not root.is_dir():
            raise WorkspaceNotFoundError(f"文件夹不存在：{root}")

        paths = WorkspacePaths.from_root(root, self._settings)
        paths.ensure_directories()
        manifest = self._load_or_create_manifest(paths)
        self._ensure_database(paths.database)
        guard = scan_guard(manifest.project_id, paths.database) if scan_guard else nullcontext()
        with guard as should_scan:
            scan_result = (
                self._scanner.scan(paths, manifest)
                if should_scan is not False
                else self._cached_scan_result(paths.database)
            )
            ensure_database_annotation_store(paths)
        opened_at = utc_now_iso()
        self._registry.upsert(manifest, root, opened_at)
        return self._summary(paths, manifest, opened_at), scan_result

    @staticmethod
    def _cached_scan_result(database_path: Path) -> ScanResult:
        total, _, _ = AssetRepository(database_path).count_summary()
        return ScanResult(
            scanned_files=0,
            indexed_assets=total,
            added=0,
            updated=0,
            missing=0,
            failed=0,
            issues=[],
            duration_ms=0,
        )

    def list_recent(self) -> list[WorkspaceSummary]:
        summaries: list[WorkspaceSummary] = []
        for row in self._registry.list_rows():
            root = Path(str(row["root_path"]))
            exists = root.is_dir()
            if exists:
                paths = WorkspacePaths.from_root(root, self._settings)
                try:
                    manifest = self._load_manifest(paths)
                    self._ensure_database(paths.database)
                    if manifest.project_id != str(row["project_id"]):
                        self._registry.upsert(
                            manifest,
                            root,
                            str(row["last_opened_at"]),
                        )
                    summaries.append(self._summary(paths, manifest, str(row["last_opened_at"])))
                    continue
                except (OSError, ValueError, json.JSONDecodeError):
                    exists = False
            summaries.append(
                WorkspaceSummary(
                    project_id=str(row["project_id"]),
                    name=str(row["name"]),
                    root_path=str(root),
                    exists=exists,
                    created_at=str(row["created_at"]),
                    last_opened_at=str(row["last_opened_at"]),
                    settings={},
                )
            )
        return summaries

    def get(self, project_id: str) -> tuple[WorkspacePaths, WorkspaceManifest]:
        root = self._registry.resolve_path(project_id)
        if root is None or not root.is_dir():
            raise WorkspaceNotFoundError(f"工作区不可用：{project_id}")
        paths = WorkspacePaths.from_root(root.resolve(), self._settings)
        manifest = self._load_manifest(paths)
        paths.ensure_directories()
        self._ensure_database(paths.database)
        ensure_database_annotation_store(paths)
        return paths, manifest

    def get_summary(self, project_id: str) -> WorkspaceSummary:
        paths, manifest = self.get(project_id)
        return self._summary(paths, manifest, None)

    def recent_project_ids(self) -> list[str]:
        return self._registry.list_recent_project_ids()

    def recent_path(self, project_id: str) -> Path | None:
        return self._registry.recent_path(project_id)

    def remove_recent(self, project_id: str) -> None:
        if not self._registry.hide_recent(project_id):
            raise WorkspaceNotFoundError(f"最近项目中找不到工作区：{project_id}")

    def mark_worker_activity(
        self,
        project_id: str,
        kind: WorkerActivityKind,
    ) -> None:
        self._registry.mark_worker_activity(project_id, kind)

    def worker_candidates(
        self,
        kind: WorkerActivityKind,
    ) -> list[WorkerWorkspaceCandidate]:
        return self._registry.list_worker_candidates(kind)

    def clear_worker_activity(
        self,
        project_id: str,
        kind: WorkerActivityKind,
        *,
        requested_at: str | None = None,
    ) -> bool:
        return self._registry.clear_worker_activity(
            project_id,
            kind,
            requested_at=requested_at,
        )

    def rescan(self, project_id: str) -> tuple[WorkspaceSummary, ScanResult]:
        paths, manifest = self.get(project_id)
        result = self._scanner.scan(paths, manifest)
        ensure_database_annotation_store(paths)
        return self._summary(paths, manifest, None), result

    def update_settings(self, project_id: str, update: WorkspaceSettingsUpdate) -> WorkspaceSummary:
        paths, manifest = self.get(project_id)
        next_settings = manifest.settings.model_copy(update=update.model_dump(exclude_none=True))
        next_manifest = manifest.model_copy(update={"settings": next_settings})
        self._save_manifest(paths, next_manifest)
        if next_settings.recursive_scan != manifest.settings.recursive_scan:
            self._scanner.scan(paths, next_manifest)
            ensure_database_annotation_store(paths)
        return self._summary(paths, next_manifest, None)

    def _load_or_create_manifest(self, paths: WorkspacePaths) -> WorkspaceManifest:
        if paths.manifest.is_file():
            return self._load_manifest(paths)
        manifest = WorkspaceManifest(
            project_id=str(uuid.uuid4()),
            name=paths.root.name,
            created_at=utc_now_iso(),
        )
        self._save_manifest(paths, manifest)
        return manifest

    def _ensure_database(self, database_path: Path) -> None:
        resolved = database_path.resolve()
        if resolved in self._initialized_databases:
            return
        with self._database_init_lock:
            if resolved in self._initialized_databases:
                return
            initialize_workspace_database(resolved)
            recover_stale_operation_leases(resolved)
            self._initialized_databases.add(resolved)

    @staticmethod
    def _load_manifest(paths: WorkspacePaths) -> WorkspaceManifest:
        return WorkspaceManifest.model_validate_json(paths.manifest.read_text(encoding="utf-8"))

    @staticmethod
    def _save_manifest(paths: WorkspacePaths, manifest: WorkspaceManifest) -> None:
        atomic_write_text(paths.manifest, manifest.model_dump_json(indent=2) + "\n")

    @staticmethod
    def _summary(
        paths: WorkspacePaths, manifest: WorkspaceManifest, opened_at: str | None
    ) -> WorkspaceSummary:
        total, annotated, invalid = AssetRepository(paths.database).count_summary()
        return WorkspaceSummary(
            project_id=manifest.project_id,
            name=manifest.name,
            root_path=str(paths.root),
            created_at=manifest.created_at,
            last_opened_at=opened_at,
            settings=manifest.settings,
            asset_count=total,
            annotated_count=annotated,
            invalid_count=invalid,
        )
