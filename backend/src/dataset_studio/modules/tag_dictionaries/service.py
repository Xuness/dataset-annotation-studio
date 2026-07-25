from __future__ import annotations

import json
import os
import shutil
import threading
import uuid
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path

from filelock import FileLock, Timeout

from dataset_studio.core.config import Settings
from dataset_studio.core.errors import StudioError
from dataset_studio.core.files import file_sha256
from dataset_studio.core.time import utc_now_iso
from dataset_studio.modules.tag_dictionaries.adapters.base import (
    DICTIONARY_DATABASE_NAME,
    validate_normalized_database,
)
from dataset_studio.modules.tag_dictionaries.installer import (
    MANIFEST_NAME,
    TagDictionaryInstaller,
)
from dataset_studio.modules.tag_dictionaries.models import (
    TagDictionaryExecutionProfile,
    TagDictionaryExecutionSource,
    TagDictionaryImportRequest,
    TagDictionaryInstallation,
    TagDictionaryInstallationStatus,
    TagDictionaryInstallationUpdate,
    TagDictionaryLibrary,
    TagDictionaryManifest,
    TagDictionaryOrderUpdate,
    TagDictionaryOverride,
    TagDictionaryOverrideUpsert,
    TagDictionaryResolution,
    TagDictionarySearchResult,
    TagDictionarySourceRecord,
    normalize_tag_key,
)
from dataset_studio.modules.tag_dictionaries.registry import TagDictionaryAdapterRegistry
from dataset_studio.modules.tag_dictionaries.repository import TagDictionaryRepository
from dataset_studio.modules.tag_dictionaries.resolver import TagDictionaryResolver
from dataset_studio.modules.taggers.service import TaggerService


class TagDictionaryNotFoundError(StudioError):
    """Raised when a local Tag dictionary installation is missing."""


class TagDictionaryService:
    def __init__(
        self,
        settings: Settings,
        repository: TagDictionaryRepository,
        taggers: TaggerService,
        registry: TagDictionaryAdapterRegistry | None = None,
    ) -> None:
        self._settings = settings
        self._repository = repository
        self._taggers = taggers
        self._registry = registry or TagDictionaryAdapterRegistry()
        self._catalog_lock = threading.RLock()
        self._catalog_state = threading.local()
        if self._repository.get_dictionary_root() is None:
            self._repository.set_dictionary_root(
                str(self._derive_default_root()),
                utc_now_iso(),
            )
        self.dictionary_root().mkdir(parents=True, exist_ok=True)
        self._installer = TagDictionaryInstaller(
            repository,
            self._registry,
            self.dictionary_root,
        )
        self._resolver = TagDictionaryResolver(repository, self.dictionary_root)

    @property
    def repository(self) -> TagDictionaryRepository:
        return self._repository

    @property
    def registry(self) -> TagDictionaryAdapterRegistry:
        return self._registry

    def dictionary_root(self) -> Path:
        configured = self._repository.get_dictionary_root()
        if configured:
            return Path(configured).expanduser().resolve()
        return self._derive_default_root()

    def _derive_default_root(self) -> Path:
        if self._settings.source_root is not None:
            return (self._settings.source_root / "dictionaries").resolve()
        tagger_root = self._taggers.model_root().resolve()
        if (
            tagger_root.name.casefold() == "taggers"
            and tagger_root.parent.name.casefold() == "models"
        ):
            return (tagger_root.parent.parent / "dictionaries").resolve()
        return (self._settings.app_data_dir / "dictionaries").resolve()

    @contextmanager
    def catalog_guard(self) -> Iterator[None]:
        with self._catalog_lock:
            depth = int(getattr(self._catalog_state, "depth", 0))
            if depth:
                self._catalog_state.depth = depth + 1
                try:
                    yield
                finally:
                    self._catalog_state.depth = depth
                return
            root = self.dictionary_root()
            lock_path = root / ".locks" / "catalog.lock"
            lock_path.parent.mkdir(parents=True, exist_ok=True)
            try:
                with FileLock(lock_path, timeout=30):
                    self._catalog_state.depth = 1
                    try:
                        yield
                    finally:
                        self._catalog_state.depth = 0
            except Timeout as error:
                raise ValueError("本地 Tag 词典库正在更新，请稍后重试。") from error

    def library(self) -> TagDictionaryLibrary:
        root = self.dictionary_root()
        root.mkdir(parents=True, exist_ok=True)
        installations: list[TagDictionaryInstallation] = []
        issues: list[str] = []
        for row in self._repository.list_installations():
            installation = self._installation_from_row(row, root)
            installations.append(installation)
            if installation.issue:
                issues.append(f"{installation.name}：{installation.issue}")
        return TagDictionaryLibrary(
            dictionary_root=str(root),
            disk_size=sum(item.disk_size for item in installations),
            entry_count=sum(
                item.entry_count
                for item in installations
                if item.enabled and item.status == TagDictionaryInstallationStatus.READY
            ),
            override_count=self._repository.override_count(),
            installations=installations,
            supported_adapters=self._registry.list(),
            scan_issues=issues,
        )

    def import_local(self, data: TagDictionaryImportRequest) -> TagDictionaryLibrary:
        source = Path(data.path).expanduser()
        if not source.is_absolute():
            raise ValueError("词典导入路径必须是绝对路径。")
        with self.catalog_guard():
            self._installer.import_local(source, requested_name=data.name)
        return self.library()

    def install_catalog_download(
        self,
        source: Path,
        *,
        adapter_id: str,
        source_record: TagDictionarySourceRecord,
        name: str,
    ) -> TagDictionaryInstallation:
        manifest = self._installer.install_catalog_download(
            source,
            adapter_id=adapter_id,
            source_record=source_record,
            requested_name=name,
        )
        row = self._repository.get_installation(manifest.installation_id)
        assert row is not None
        return self._installation_from_row(row, self.dictionary_root())

    def find_by_source(
        self,
        source_id: str,
        source_version: str,
    ) -> TagDictionaryInstallation | None:
        row = self._repository.get_installation_by_source(source_id, source_version)
        return self._installation_from_row(row, self.dictionary_root()) if row is not None else None

    def update_installation(
        self,
        installation_id: str,
        data: TagDictionaryInstallationUpdate,
    ) -> TagDictionaryInstallation:
        with self.catalog_guard():
            row = self._repository.get_installation(installation_id)
            if row is None:
                raise TagDictionaryNotFoundError(f"找不到本地 Tag 词典：{installation_id}")
            name = data.name or str(row["name"])
            enabled = bool(row["enabled"]) if data.enabled is None else data.enabled
            self._repository.update_installation(
                installation_id,
                name=name,
                enabled=enabled,
                updated_at=utc_now_iso(),
            )
            updated = self._repository.get_installation(installation_id)
        assert updated is not None
        return self._installation_from_row(updated, self.dictionary_root())

    def reorder(self, data: TagDictionaryOrderUpdate) -> TagDictionaryLibrary:
        with self.catalog_guard():
            self._repository.replace_order(data.installation_ids, utc_now_iso())
        return self.library()

    def delete_installation(self, installation_id: str) -> TagDictionaryLibrary:
        with self.catalog_guard():
            row = self._repository.get_installation(installation_id)
            if row is None:
                raise TagDictionaryNotFoundError(f"找不到本地 Tag 词典：{installation_id}")
            root = self.dictionary_root().resolve()
            target = (root / str(row["relative_path"])).resolve()
            if not target.is_relative_to(root):
                raise ValueError("词典安装路径超出受管目录，拒绝删除。")
            trash = (root / ".staging" / f"delete-{uuid.uuid4()}").resolve()
            trash.parent.mkdir(parents=True, exist_ok=True)
            if target.exists():
                if target.is_symlink() or not target.is_dir():
                    raise ValueError("词典安装路径不是安全的受管目录。")
                os.replace(target, trash)
            try:
                if not self._repository.delete_installation(installation_id):
                    raise TagDictionaryNotFoundError(f"找不到本地 Tag 词典：{installation_id}")
            except BaseException:
                if trash.exists() and not target.exists():
                    os.replace(trash, target)
                raise
            if trash.exists():
                shutil.rmtree(trash)
        return self.library()

    def resolve(self, tags: list[str], language: str) -> TagDictionaryResolution:
        with self.catalog_guard():
            return self._resolver.resolve(tags, language)

    def execution_profile(self, language: str) -> TagDictionaryExecutionProfile:
        with self.catalog_guard():
            sources: list[TagDictionaryExecutionSource] = []
            for row in self._repository.list_enabled_installations(language):
                installation = self._installation_from_row(
                    row,
                    self.dictionary_root(),
                )
                if installation.status != TagDictionaryInstallationStatus.READY:
                    continue
                sources.append(
                    TagDictionaryExecutionSource(
                        installation_id=installation.id,
                        name=installation.name,
                        adapter_id=installation.adapter_id,
                        source_id=installation.source_id,
                        source_version=installation.source_version,
                        fingerprint=installation.fingerprint,
                        priority=installation.priority,
                    )
                )
            return TagDictionaryExecutionProfile(
                language=language,
                sources=sources,
                override_count=self._repository.override_count(language),
            )

    def search(
        self,
        query: str,
        language: str,
        *,
        offset: int,
        limit: int,
    ) -> TagDictionarySearchResult:
        with self.catalog_guard():
            return self._resolver.search(
                query,
                language,
                offset=offset,
                limit=limit,
            )

    def upsert_override(self, data: TagDictionaryOverrideUpsert) -> TagDictionaryOverride:
        with self.catalog_guard():
            row = self._repository.upsert_override(
                normalized_tag=normalize_tag_key(data.tag),
                tag=data.tag,
                language=data.language,
                translation=data.translation,
                category=data.category,
                timestamp=utc_now_iso(),
            )
        return _override_from_row(row)

    def delete_override(self, tag: str, language: str) -> bool:
        with self.catalog_guard():
            return self._repository.delete_override(normalize_tag_key(tag), language)

    def _installation_from_row(self, row, root: Path) -> TagDictionaryInstallation:
        directory = (root / str(row["relative_path"])).resolve()
        status = TagDictionaryInstallationStatus.READY
        issue: str | None = None
        manifest: TagDictionaryManifest | None = None
        disk_size = 0
        try:
            if not directory.is_relative_to(root.resolve()):
                raise ValueError("安装路径超出词典库。")
            if not directory.is_dir() or directory.is_symlink():
                status = TagDictionaryInstallationStatus.MISSING
                raise ValueError("安装目录不存在。")
            manifest_path = directory / MANIFEST_NAME
            database_path = directory / DICTIONARY_DATABASE_NAME
            manifest = TagDictionaryManifest.model_validate_json(
                manifest_path.read_text(encoding="utf-8")
            )
            if manifest.installation_id != str(row["id"]):
                raise ValueError("安装清单 ID 与全局记录不一致。")
            validate_normalized_database(
                database_path,
                expected_adapter_id=str(row["adapter_id"]),
                expected_fingerprint=str(row["fingerprint"]),
            )
            if file_sha256(database_path) != manifest.database_sha256:
                raise ValueError("词典数据库文件校验值与安装清单不一致。")
            disk_size = sum(
                path.stat().st_size
                for path in directory.rglob("*")
                if path.is_file() and not path.is_symlink()
            )
        except (OSError, ValueError, json.JSONDecodeError) as error:
            if status != TagDictionaryInstallationStatus.MISSING:
                status = TagDictionaryInstallationStatus.INVALID
            issue = str(error) or type(error).__name__
        if manifest is None:
            manifest = TagDictionaryManifest.model_validate_json(str(row["manifest_json"]))
        return TagDictionaryInstallation(
            id=str(row["id"]),
            name=str(row["name"]),
            adapter_id=str(row["adapter_id"]),
            source_id=str(row["source_id"]),
            source_version=str(row["source_version"]),
            language=str(row["language"]),
            path=str(directory),
            fingerprint=str(row["fingerprint"]),
            entry_count=int(row["entry_count"]),
            disk_size=disk_size,
            enabled=bool(row["enabled"]),
            priority=int(row["priority"]),
            status=status,
            issue=issue,
            source_url=manifest.source_url,
            license_id=manifest.license_id,
            license_url=manifest.license_url,
            license_status=manifest.license_status,
            created_at=str(row["created_at"]),
            updated_at=str(row["updated_at"]),
        )


def _override_from_row(row) -> TagDictionaryOverride:
    return TagDictionaryOverride(
        tag=str(row["tag"]),
        normalized_tag=str(row["normalized_tag"]),
        translation=str(row["translation"]),
        language=str(row["language"]),
        category=str(row["category"]) if row["category"] else None,
        revision=int(row["revision"]),
        created_at=str(row["created_at"]),
        updated_at=str(row["updated_at"]),
    )
