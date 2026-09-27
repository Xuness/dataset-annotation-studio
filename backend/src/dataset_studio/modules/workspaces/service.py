from __future__ import annotations

import threading
from collections.abc import Callable
from contextlib import AbstractContextManager, nullcontext
from pathlib import Path

from filelock import FileLock

from dataset_studio.core.config import Settings
from dataset_studio.core.errors import WorkspaceNotFoundError
from dataset_studio.core.files import atomic_write_text
from dataset_studio.core.time import utc_now_iso
from dataset_studio.modules.annotations.legacy_import import ensure_database_annotation_store
from dataset_studio.modules.assets.repository import AssetRepository
from dataset_studio.modules.assets.scanner import AssetScanner
from dataset_studio.modules.output_resources import recover_stale_operation_leases
from dataset_studio.modules.workspaces.backups import index_existing_originals
from dataset_studio.modules.workspaces.models import (
    ScanResult,
    WorkspaceManifest,
    WorkspaceSettings,
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
from dataset_studio.modules.workspaces.storage import (
    choose_project,
    directory_identity,
    locations,
    migrate_embedded,
    save_location,
    validate_association,
    validate_root,
)


class WorkspaceService:
    @property
    def settings(self) -> Settings:
        return self._settings

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
        independent_copy: bool = False,
        scan_guard: Callable[[str, Path], AbstractContextManager[bool | None]] | None = None,
    ) -> tuple[WorkspaceSummary, ScanResult]:
        root = Path(raw_path).expanduser().resolve()
        if not root.is_dir():
            raise WorkspaceNotFoundError(f"文件夹不存在：{root}")

        validate_root(self._settings, root)
        with FileLock(self._settings.app_data_dir / "workspace-registration.lock"):
            project_id = choose_project(self._settings, root, independent_copy)
            migrated = migrate_embedded(self._settings, root, project_id)
            paths = WorkspacePaths.for_project(root, self._settings, project_id)
            paths.ensure_directories()
            manifest = self._load_or_create_manifest(paths, project_id)
            self._ensure_database(paths.database)
            if migrated:
                ensure_database_annotation_store(paths)
            index_existing_originals(paths)
            save_location(self._settings.app_data_dir / "global.sqlite3", root, project_id)
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
        registered = {
            item.project_id: item
            for item in locations(self._settings.app_data_dir / "global.sqlite3")
        }
        for row in self._registry.list_rows():
            project_id = str(row["project_id"])
            location = registered.get(project_id)
            root = location.root_path if location else Path(str(row["root_path"]))
            paths = WorkspacePaths.for_project(root, self._settings, project_id)
            state = "detached" if location and not location.attached else "attached"
            if location and location.storage_version == 0:
                state = "migration_required"
            if state == "attached":
                try:
                    validate_association(
                        self._settings.app_data_dir / "global.sqlite3",
                        root,
                        project_id,
                        location.directory_identity or "",
                    )
                except ValueError:
                    state = "conflict"
            exists = root.is_dir() and state == "attached"
            if exists and location and location.directory_identity != directory_identity(root):
                state, exists = "identity_changed", False
            legacy = WorkspacePaths.from_root(root, self._settings)
            can_migrate = (
                state == "migration_required"
                and root.is_dir()
                and legacy.manifest.is_file()
                and legacy.database.is_file()
            )
            if paths.manifest.is_file():
                manifest = self._load_manifest(paths)
                self._ensure_database(paths.database)
                summary = self._summary(paths, manifest, str(row["last_opened_at"]))
                summaries.append(
                    summary.model_copy(update={"exists": exists, "association_state": state})
                )
            else:
                summaries.append(
                    WorkspaceSummary(
                        project_id=project_id,
                        name=str(row["name"]),
                        root_path=str(root),
                        storage_path=str(paths.internal),
                        exists=can_migrate,
                        association_state=state,
                        created_at=str(row["created_at"]),
                        last_opened_at=str(row["last_opened_at"]),
                        settings={},
                    )
                )
        return summaries

    def get(self, project_id: str) -> tuple[WorkspacePaths, WorkspaceManifest]:
        database = self._settings.app_data_dir / "global.sqlite3"
        location = next(
            (item for item in locations(database) if item.project_id == project_id), None
        )
        if location is None or not location.attached or not location.root_path.is_dir():
            raise WorkspaceNotFoundError(f"工作区不可用，请重新关联数据集：{project_id}")
        root = location.root_path.resolve()
        if location.storage_version == 0:
            self.open(str(root))
            return self.get(project_id)
        if location.directory_identity != directory_identity(root):
            raise ValueError("数据集目录身份已改变，请重新定位项目。")
        validate_association(database, root, project_id, location.directory_identity)
        paths = WorkspacePaths.for_project(root, self._settings, project_id)
        manifest = self._load_manifest(paths)
        if manifest.project_id != project_id:
            raise ValueError("工作区清单 ID 与登记不一致。")
        paths.ensure_directories()
        self._ensure_database(paths.database)
        ensure_database_annotation_store(paths)
        return paths, manifest

    def stored_paths(self, project_id: str) -> WorkspacePaths:
        location = next(
            (
                item
                for item in locations(self._settings.app_data_dir / "global.sqlite3")
                if item.project_id == project_id
            ),
            None,
        )
        if location is None:
            raise WorkspaceNotFoundError(f"项目没有登记：{project_id}")
        return WorkspacePaths.for_project(location.root_path, self._settings, project_id)

    def refresh_association(self, project_id: str) -> None:
        paths, manifest = self.get(project_id)
        self._registry.upsert(manifest, paths.root, utc_now_iso())
        self.rescan(project_id)

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
        next_settings = WorkspaceSettings.model_validate(
            manifest.settings.model_dump() | update.model_dump(exclude_none=True)
        )
        next_manifest = manifest.model_copy(update={"settings": next_settings})
        self._save_manifest(paths, next_manifest)
        if next_settings.recursive_scan != manifest.settings.recursive_scan:
            self._scanner.scan(paths, next_manifest)
            ensure_database_annotation_store(paths)
        return self._summary(paths, next_manifest, None)

    def _load_or_create_manifest(self, paths: WorkspacePaths, project_id: str) -> WorkspaceManifest:
        if paths.manifest.is_file():
            return self._load_manifest(paths)
        manifest = WorkspaceManifest(
            project_id=project_id,
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
            storage_path=str(paths.internal),
            created_at=manifest.created_at,
            last_opened_at=opened_at,
            settings=manifest.settings,
            asset_count=total,
            annotated_count=annotated,
            invalid_count=invalid,
        )
