from __future__ import annotations

import json
import os
import shutil
import sqlite3
import threading
import uuid
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from functools import wraps
from pathlib import Path
from typing import Concatenate, ParamSpec, TypeVar

from filelock import FileLock, Timeout

from dataset_studio.core.config import Settings
from dataset_studio.core.errors import TaggerNotFoundError
from dataset_studio.core.files import atomic_write_text
from dataset_studio.core.time import utc_now_iso
from dataset_studio.modules.taggers.adapters.base import TaggerAdapter, ValidatedTaggerModel
from dataset_studio.modules.taggers.installer import MANIFEST_NAME, TaggerInstaller
from dataset_studio.modules.taggers.models import (
    TaggerDevice,
    TaggerExecutionProfile,
    TaggerImportRequest,
    TaggerInstallation,
    TaggerInstallationManifest,
    TaggerInstallationStatus,
    TaggerLibrary,
    TaggerProfile,
    TaggerProfileCapabilities,
    TaggerProfileCreate,
    TaggerProfileUpdate,
    TaggerRuntimeInfo,
    TaggerSelectionMode,
    TaggerSelectionPolicy,
    TaggerSettingsUpdate,
    TaggerSourceRecord,
)
from dataset_studio.modules.taggers.registry import TaggerAdapterRegistry
from dataset_studio.modules.taggers.repository import TaggerRepository
from dataset_studio.modules.taggers.sources.base import (
    TaggerDownloadPlan,
    TaggerMaterializedModel,
)

_P = ParamSpec("_P")
_R = TypeVar("_R")


def _catalog_locked(
    method: Callable[Concatenate[TaggerService, _P], _R],
) -> Callable[Concatenate[TaggerService, _P], _R]:
    @wraps(method)
    def wrapped(self: TaggerService, *args: _P.args, **kwargs: _P.kwargs) -> _R:
        with self.catalog_guard():
            return method(self, *args, **kwargs)

    return wrapped


class TaggerService:
    def __init__(
        self,
        settings: Settings,
        repository: TaggerRepository,
        registry: TaggerAdapterRegistry | None = None,
    ) -> None:
        self._settings = settings
        self._repository = repository
        self._registry = registry or TaggerAdapterRegistry()
        self._catalog_lock = threading.RLock()
        self._catalog_state = threading.local()
        self._has_blocking_downloads: Callable[[], bool] = lambda: False
        self._installer = TaggerInstaller(repository, self._registry, self.model_root)
        self.model_root().mkdir(parents=True, exist_ok=True)

    @property
    def registry(self) -> TaggerAdapterRegistry:
        return self._registry

    @contextmanager
    def catalog_guard(self) -> Iterator[None]:
        """Serialize catalog mutation across API and worker processes."""
        with self._catalog_lock:
            depth = int(getattr(self._catalog_state, "depth", 0))
            if depth:
                self._catalog_state.depth = depth + 1
                try:
                    yield
                finally:
                    self._catalog_state.depth = depth
                return
            root = self.model_root()
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
                raise ValueError("本地打标器模型库正由另一个进程更新，请稍后重试。") from error

    def set_download_activity_check(self, callback: Callable[[], bool]) -> None:
        self._has_blocking_downloads = callback

    def model_root(self) -> Path:
        configured = self._repository.get_model_root()
        return (
            Path(configured).expanduser().resolve()
            if configured
            else (self._settings.app_data_dir / "models" / "taggers").resolve()
        )

    def library(self, *, scan_issues: list[str] | None = None) -> TaggerLibrary:
        root = self.model_root()
        root.mkdir(parents=True, exist_ok=True)
        runtime = self.runtime_info()
        installations = [
            self._installation_from_row(row, root) for row in self._repository.list_installations()
        ]
        installation_by_id = {installation.id: installation for installation in installations}
        profiles = [
            self._profile_from_row(row, installation_by_id, runtime)
            for row in self._repository.list_profiles()
        ]
        return TaggerLibrary(
            model_root=str(root),
            disk_size=sum(installation.disk_size for installation in installations),
            installations=installations,
            profiles=profiles,
            runtime=runtime,
            supported_adapters=self._registry.list(),
            scan_issues=scan_issues or [],
        )

    @_catalog_locked
    def update_settings(self, data: TaggerSettingsUpdate) -> TaggerLibrary:
        candidate = Path(data.model_root).expanduser()
        if not candidate.is_absolute():
            raise ValueError("本地打标器模型库必须使用绝对路径。")
        root = candidate.resolve()
        current = self.model_root()
        if root == current:
            return self.library()
        if self._has_blocking_downloads():
            raise ValueError("仍有未完成或可恢复的模型下载，请先完成或清理下载任务。")
        if self._repository.list_installations():
            raise ValueError("模型库中已有安装；请先删除或手动迁移模型后再更改模型库位置。")
        if root.exists() and not root.is_dir():
            raise ValueError("选择的模型库路径不是文件夹。")
        root.mkdir(parents=True, exist_ok=True)
        self._repository.set_model_root(str(root), utc_now_iso())
        return self.library()

    @_catalog_locked
    def import_local(self, data: TaggerImportRequest) -> TaggerLibrary:
        source = Path(data.path).expanduser()
        if not source.is_absolute():
            raise ValueError("导入路径必须是绝对路径。")
        source = source.resolve()
        manifest = self._installer.import_local(source, requested_name=data.name)
        self._create_default_profile(manifest)
        return self.library()

    @_catalog_locked
    def install_downloaded(
        self,
        materialized: TaggerMaterializedModel,
        plan: TaggerDownloadPlan,
    ) -> TaggerInstallation:
        manifest = self._installer.install_materialized(materialized, plan)
        self._create_default_profile(manifest)
        row = self._repository.get_installation(manifest.installation_id)
        assert row is not None
        return self._installation_from_row(row, self.model_root())

    @_catalog_locked
    def rescan(self) -> TaggerLibrary:
        root = self.model_root()
        root.mkdir(parents=True, exist_ok=True)
        issues: list[str] = []
        known_paths = {
            str(row["relative_path"]): str(row["id"])
            for row in self._repository.list_installations()
        }
        candidates, truncated = self._registry.candidate_directories(root)
        if truncated:
            issues.append("模型库候选目录超过 200 个，本次扫描已提前停止。")
        for candidate in candidates:
            if not candidate.is_relative_to(root):
                issues.append(f"忽略了模型库外的链接目录：{candidate}")
                continue
            relative_path = candidate.relative_to(root).as_posix()
            existing_id = known_paths.get(relative_path)
            if existing_id:
                # Rescan only discovers catalog entries. Existing installations
                # use the cheap manifest/stat check in library(); rehashing a
                # multi-gigabyte model is reserved for explicit validation.
                try:
                    self.ensure_default_profile(existing_id)
                except (OSError, sqlite3.Error, ValueError) as error:
                    issues.append(f"{relative_path}：{error}")
                continue
            try:
                adapter, validated = self._registry.detect(candidate)
                manifest = self._adopt_directory(candidate, adapter, validated)
                self._repository.insert_installation(
                    self._installer.installation_values(
                        manifest,
                        relative_path,
                        manifest.created_at,
                    )
                )
                self._create_default_profile(manifest)
            except (OSError, sqlite3.Error, ValueError) as error:
                issues.append(f"{relative_path}：{error}")
        return self.library(scan_issues=issues)

    @_catalog_locked
    def validate_installation(self, installation_id: str) -> TaggerInstallation:
        row = self._repository.get_installation(installation_id)
        if row is None:
            raise TaggerNotFoundError(f"找不到本地打标器模型：{installation_id}")
        root = self.model_root()
        directory = self._installation_path(root, str(row["relative_path"]))
        if not directory.is_dir():
            raise ValueError("模型安装目录已不存在。")
        adapter = self._registry.get(str(row["adapter_id"]))
        validated = adapter.validate(directory)
        previous = self._manifest_from_row(row)
        assert previous is not None
        files = [self._installer.hash_file(directory, name) for name in validated.managed_files]
        manifest = self._installer.build_manifest(
            installation_id=installation_id,
            name=str(row["name"]),
            validated=validated,
            files=files,
            source=previous.source,
            created_at=str(row["created_at"]),
        )
        atomic_write_text(
            directory / MANIFEST_NAME,
            manifest.model_dump_json(indent=2) + "\n",
        )
        now = utc_now_iso()
        self._repository.update_installation(
            installation_id,
            name=manifest.name,
            model_version=manifest.model_version,
            fingerprint=manifest.fingerprint,
            manifest_json=manifest.model_dump_json(),
            updated_at=now,
        )
        refreshed = self._repository.get_installation(installation_id)
        assert refreshed is not None
        return self._installation_from_row(refreshed, root)

    @_catalog_locked
    def delete_installation(self, installation_id: str) -> TaggerLibrary:
        row = self._repository.get_installation(installation_id)
        if row is None:
            raise TaggerNotFoundError(f"找不到本地打标器模型：{installation_id}")
        root = self.model_root()
        directory = self._installation_path(root, str(row["relative_path"]))
        trash = (root / ".trash" / installation_id).resolve()
        moved = False
        if directory.exists():
            trash.parent.mkdir(parents=True, exist_ok=True)
            if trash.exists():
                shutil.rmtree(trash)
            os.replace(directory, trash)
            moved = True
        try:
            if not self._repository.delete_installation(installation_id):
                raise TaggerNotFoundError(f"找不到本地打标器模型：{installation_id}")
        except BaseException:
            if moved and trash.exists():
                directory.parent.mkdir(parents=True, exist_ok=True)
                os.replace(trash, directory)
            raise
        if moved:
            shutil.rmtree(trash, ignore_errors=True)
        return self.library()

    def list_profiles(self) -> list[TaggerProfile]:
        return self.library().profiles

    def has_installation(self, installation_id: str) -> bool:
        return self._repository.get_installation(installation_id) is not None

    @_catalog_locked
    def ensure_default_profile(self, installation_id: str) -> None:
        row = self._repository.get_installation(installation_id)
        if row is None:
            raise TaggerNotFoundError(f"找不到本地打标器模型：{installation_id}")
        manifest = self._manifest_from_row(row)
        if manifest is None:
            raise ValueError("本地打标器安装清单无效，无法创建默认配置。")
        self._create_default_profile(manifest)

    def get_profile(self, profile_id: str) -> TaggerProfile:
        row = self._repository.get_profile(profile_id)
        if row is None:
            raise TaggerNotFoundError(f"找不到本地打标配置：{profile_id}")
        library = self.library()
        profile = next((item for item in library.profiles if item.id == profile_id), None)
        if profile is None:
            raise TaggerNotFoundError(f"找不到本地打标配置：{profile_id}")
        return profile

    @_catalog_locked
    def create_profile(self, data: TaggerProfileCreate) -> TaggerProfile:
        installation = self._ready_installation(data.installation_id)
        categories = data.categories or installation.profile_capabilities.default_categories
        self._validate_categories(categories, installation)
        self._validate_selection(data.selection, installation)
        now = utc_now_iso()
        profile = TaggerProfile(
            id=str(uuid.uuid4()),
            name=data.name.strip(),
            installation_id=installation.id,
            selection=data.selection,
            categories=categories,
            device=data.device,
            concurrency=data.concurrency,
            batch_size=data.batch_size,
            created_at=now,
            updated_at=now,
        )
        try:
            self._repository.insert_profile(self._profile_insert_values(profile))
        except sqlite3.IntegrityError as error:
            raise ValueError(f"本地打标配置名称已存在：{profile.name}") from error
        return self.get_profile(profile.id)

    @_catalog_locked
    def update_profile(self, profile_id: str, data: TaggerProfileUpdate) -> TaggerProfile:
        current = self.get_profile(profile_id)
        values = data.model_dump(exclude_none=True)
        if data.selection is not None:
            values["selection"] = data.selection
        if "batch_size" in data.model_fields_set:
            values["batch_size"] = data.batch_size
        installation_id = str(values.get("installation_id", current.installation_id))
        installation = self._ready_installation(installation_id)
        categories = list(values.get("categories", current.categories))
        self._validate_categories(categories, installation)
        selection = data.selection or current.selection
        self._validate_selection(selection, installation)
        updated = current.model_copy(
            update={
                **values,
                "name": str(values.get("name", current.name)).strip(),
                "installation_id": installation_id,
                "categories": categories,
                "selection": selection,
                "updated_at": utc_now_iso(),
            }
        )
        try:
            self._repository.update_profile(profile_id, self._profile_update_values(updated))
        except sqlite3.IntegrityError as error:
            raise ValueError(f"本地打标配置名称已存在：{updated.name}") from error
        return self.get_profile(profile_id)

    @_catalog_locked
    def delete_profile(self, profile_id: str) -> TaggerLibrary:
        if not self._repository.delete_profile(profile_id):
            raise TaggerNotFoundError(f"找不到本地打标配置：{profile_id}")
        return self.library()

    @_catalog_locked
    def resolve_execution_profile(self, profile_id: str) -> TaggerExecutionProfile:
        profile = self.get_profile(profile_id)
        installation = self._ready_installation(profile.installation_id)
        if not profile.ready:
            raise ValueError(profile.issue or "当前本地打标配置不可用。")
        self._validate_categories(profile.categories, installation)
        return TaggerExecutionProfile(
            id=profile.id,
            name=profile.name,
            installation_id=installation.id,
            installation_name=installation.name,
            adapter_id=installation.adapter_id,
            adapter_contract_version=installation.adapter_contract_version,
            model_version=installation.model_version,
            fingerprint=installation.fingerprint,
            selection=profile.selection,
            categories=profile.categories,
            device=profile.device,
            concurrency=profile.concurrency,
            batch_size=profile.batch_size,
        )

    def resolve_snapshot(
        self,
        profile: TaggerExecutionProfile,
    ) -> tuple[Path, TaggerAdapter]:
        installation = self._ready_installation(profile.installation_id)
        if installation.fingerprint != profile.fingerprint:
            raise ValueError("本地打标器文件在任务创建后发生变化，已拒绝继续执行。")
        if installation.adapter_id != profile.adapter_id:
            raise ValueError("本地打标器适配器与任务快照不一致。")
        if installation.adapter_contract_version != profile.adapter_contract_version:
            raise ValueError("本地打标器适配器契约在任务创建后发生变化，已拒绝继续执行。")
        return Path(installation.path), self._registry.get(installation.adapter_id)

    @staticmethod
    def runtime_info() -> TaggerRuntimeInfo:
        try:
            import onnxruntime as ort
        except (ImportError, OSError) as error:
            return TaggerRuntimeInfo(
                available=False,
                error=f"ONNX Runtime 不可用：{error}",
            )
        providers = list(ort.get_available_providers())
        devices: list[TaggerDevice] = []
        if "CPUExecutionProvider" in providers:
            devices.append(TaggerDevice.CPU)
        if "CUDAExecutionProvider" in providers:
            devices.append(TaggerDevice.CUDA)
        if "DmlExecutionProvider" in providers:
            devices.append(TaggerDevice.DIRECTML)
        if devices:
            devices.insert(0, TaggerDevice.AUTO)
        return TaggerRuntimeInfo(
            available=bool(devices),
            providers=providers,
            devices=devices,
            error=None if devices else "ONNX Runtime 没有可用的本地执行提供程序。",
        )

    def _ready_installation(self, installation_id: str) -> TaggerInstallation:
        row = self._repository.get_installation(installation_id)
        if row is None:
            raise TaggerNotFoundError(f"找不到本地打标器模型：{installation_id}")
        installation = self._installation_from_row(row, self.model_root())
        if installation.status != TaggerInstallationStatus.READY:
            detail = "；".join(installation.issues) or "模型未通过校验。"
            raise ValueError(f"本地打标器模型不可用：{detail}")
        return installation

    def _installation_from_row(self, row, root: Path) -> TaggerInstallation:
        issues: list[str] = []
        try:
            directory = self._installation_path(root, str(row["relative_path"]))
        except ValueError as error:
            directory = root
            issues.append(str(error))
        manifest: TaggerInstallationManifest | None = None
        if not issues and not directory.is_dir():
            issues.append("模型目录不存在。")
            status = TaggerInstallationStatus.MISSING
        else:
            status = TaggerInstallationStatus.INVALID if issues else TaggerInstallationStatus.READY
        if not issues:
            try:
                manifest_path = directory / MANIFEST_NAME
                manifest = TaggerInstallationManifest.model_validate_json(
                    manifest_path.read_text(encoding="utf-8")
                )
                if manifest.installation_id != str(row["id"]):
                    issues.append("安装清单 ID 与全局记录不一致。")
                if manifest.fingerprint != str(row["fingerprint"]):
                    issues.append("安装清单指纹与全局记录不一致。")
                if manifest.adapter_id != str(row["adapter_id"]):
                    issues.append("安装清单适配器与全局记录不一致。")
                if manifest.model_version != str(row["model_version"]):
                    issues.append("安装清单模型版本与全局记录不一致。")
                self._registry.get(manifest.adapter_id)
                for file in manifest.files:
                    path = (directory / file.relative_path).resolve()
                    if not path.is_relative_to(directory) or not path.is_file():
                        issues.append(f"模型文件缺失：{file.relative_path}")
                        continue
                    stat = path.stat()
                    if stat.st_size != file.size or stat.st_mtime_ns != file.modified_ns:
                        issues.append(f"模型文件已发生变化：{file.relative_path}")
            except (OSError, UnicodeError, ValueError) as error:
                issues.append(f"安装清单无效：{error}")
        if status != TaggerInstallationStatus.MISSING and issues:
            status = TaggerInstallationStatus.INVALID
        fallback = self._manifest_from_row(row, strict=False)
        manifest = manifest or fallback
        categories = manifest.categories if manifest else {}
        profile_capabilities = (
            manifest.profile_capabilities
            if manifest and manifest.profile_capabilities is not None
            else self._legacy_profile_capabilities(
                str(row["adapter_id"]),
                directory,
                categories,
            )
        )
        return TaggerInstallation(
            id=str(row["id"]),
            name=str(row["name"]),
            adapter_id=str(row["adapter_id"]),
            adapter_name=self._adapter_name(str(row["adapter_id"])),
            adapter_contract_version=(
                manifest.adapter_contract_version if manifest is not None else 1
            ),
            model_version=str(row["model_version"]),
            relative_path=str(row["relative_path"]),
            path=str(directory),
            fingerprint=str(row["fingerprint"]),
            status=status,
            issues=list(dict.fromkeys(issues)),
            warnings=manifest.warnings if manifest else [],
            tag_count=manifest.tag_count if manifest else 0,
            categories=categories,
            profile_capabilities=profile_capabilities,
            files=manifest.files if manifest else [],
            source=manifest.source if manifest else None,
            disk_size=sum(file.size for file in manifest.files) if manifest else 0,
            created_at=str(row["created_at"]),
            updated_at=str(row["updated_at"]),
        )

    def _profile_from_row(
        self,
        row,
        installations: dict[str, TaggerInstallation],
        runtime: TaggerRuntimeInfo,
    ) -> TaggerProfile:
        installation = installations.get(str(row["installation_id"]))
        issues: list[str] = []
        try:
            categories = json.loads(str(row["categories_json"]))
            if not isinstance(categories, list) or not all(
                isinstance(category, str) for category in categories
            ):
                raise ValueError
        except (json.JSONDecodeError, ValueError):
            categories = []
            issues.append("配置中的标签类别无法识别。")
        try:
            raw_selection = row["selection_json"]
            selection = TaggerSelectionPolicy.model_validate_json(str(raw_selection))
        except (IndexError, KeyError, ValueError):
            selection = TaggerSelectionPolicy(
                mode=TaggerSelectionMode.GLOBAL,
                global_threshold=float(row["threshold"]),
            )
            issues.append("配置中的标签选择策略无法识别。")
        if installation is None:
            issues.append("关联的模型安装已不存在。")
        elif installation.status != TaggerInstallationStatus.READY:
            issues.append("关联的模型安装当前不可用。")
        elif not categories or not set(categories).issubset(installation.categories):
            issues.append("配置中的标签类别与当前模型不兼容。")
        elif selection.mode not in installation.profile_capabilities.supported_selection_modes:
            issues.append("配置中的标签选择策略与当前模型不兼容。")
        elif not set(selection.category_thresholds).issubset(installation.categories):
            issues.append("配置中的分类阈值与当前模型不兼容。")
        device = TaggerDevice(str(row["device"]))
        if not runtime.available:
            issues.append(runtime.error or "ONNX Runtime 不可用。")
        elif device != TaggerDevice.AUTO and device not in runtime.devices:
            issues.append(f"当前运行时不支持执行设备：{device.value}")
        return TaggerProfile(
            id=str(row["id"]),
            name=str(row["name"]),
            installation_id=str(row["installation_id"]),
            selection=selection,
            categories=categories,
            device=device,
            concurrency=int(row["concurrency"]),
            batch_size=int(row["batch_size"]) if row["batch_size"] is not None else None,
            installation_name=installation.name if installation else None,
            model_version=installation.model_version if installation else None,
            ready=not issues,
            issue="；".join(issues) if issues else None,
            created_at=str(row["created_at"]),
            updated_at=str(row["updated_at"]),
        )

    def _adopt_directory(
        self,
        directory: Path,
        adapter: TaggerAdapter,
        validated: ValidatedTaggerModel,
    ) -> TaggerInstallationManifest:
        now = utc_now_iso()
        installation_id = str(uuid.uuid4())
        files = [self._installer.hash_file(directory, name) for name in validated.managed_files]
        manifest = self._installer.build_manifest(
            installation_id=installation_id,
            name=f"{adapter.name} {validated.model_version}",
            validated=validated,
            files=files,
            source=TaggerSourceRecord(source_type="local_scan", original_path=str(directory)),
            created_at=now,
        )
        atomic_write_text(
            directory / MANIFEST_NAME,
            manifest.model_dump_json(indent=2) + "\n",
        )
        return manifest

    def _create_default_profile(self, manifest: TaggerInstallationManifest) -> None:
        profiles = self._repository.list_profiles()
        if any(str(row["installation_id"]) == manifest.installation_id for row in profiles):
            return
        base_name = f"{manifest.name} 默认配置"
        existing = {str(row["name"]).casefold() for row in profiles}
        name = base_name
        suffix = 2
        while name.casefold() in existing:
            name = f"{base_name} {suffix}"
            suffix += 1
        self.create_profile(
            TaggerProfileCreate(
                name=name,
                installation_id=manifest.installation_id,
                selection=(
                    manifest.profile_capabilities.default_selection
                    if manifest.profile_capabilities is not None
                    else TaggerSelectionPolicy()
                ),
                categories=(
                    manifest.profile_capabilities.default_categories
                    if manifest.profile_capabilities is not None
                    else sorted(manifest.categories)
                ),
                device=TaggerDevice.AUTO,
                concurrency=1,
                batch_size=None,
            )
        )

    @staticmethod
    def _installation_path(root: Path, relative_path: str) -> Path:
        directory = (root / relative_path).resolve()
        if directory == root or not directory.is_relative_to(root):
            raise ValueError("模型安装路径超出当前模型库。")
        return directory

    def _adapter_name(self, adapter_id: str) -> str:
        try:
            return self._registry.get(adapter_id).name
        except ValueError:
            return adapter_id

    @staticmethod
    def _manifest_from_row(row, *, strict: bool = True) -> TaggerInstallationManifest | None:
        try:
            return TaggerInstallationManifest.model_validate_json(str(row["manifest_json"]))
        except ValueError:
            if strict:
                raise ValueError("全局数据库中的安装清单无法识别。") from None
            return None

    @staticmethod
    def _profile_insert_values(profile: TaggerProfile) -> tuple[object, ...]:
        return (
            profile.id,
            profile.name,
            profile.installation_id,
            profile.selection.global_threshold,
            profile.selection.model_dump_json(),
            json.dumps(profile.categories, ensure_ascii=False),
            profile.device.value,
            profile.concurrency,
            profile.batch_size,
            profile.created_at,
            profile.updated_at,
        )

    @staticmethod
    def _profile_update_values(profile: TaggerProfile) -> tuple[object, ...]:
        return (
            profile.name,
            profile.installation_id,
            profile.selection.global_threshold,
            profile.selection.model_dump_json(),
            json.dumps(profile.categories, ensure_ascii=False),
            profile.device.value,
            profile.concurrency,
            profile.batch_size,
            profile.updated_at,
        )

    @staticmethod
    def _validate_categories(
        categories: list[str],
        installation: TaggerInstallation,
    ) -> None:
        if not categories:
            raise ValueError("本地打标配置至少需要启用一个标签类别。")
        unknown = sorted(set(categories) - set(installation.categories))
        if unknown:
            raise ValueError("当前模型不包含这些标签类别：" + "、".join(unknown))

    @staticmethod
    def _validate_selection(
        selection: TaggerSelectionPolicy,
        installation: TaggerInstallation,
    ) -> None:
        capabilities = installation.profile_capabilities
        if selection.mode not in capabilities.supported_selection_modes:
            raise ValueError(f"当前模型不支持标签选择模式：{selection.mode.value}")
        unknown = sorted(set(selection.category_thresholds) - set(installation.categories))
        if unknown:
            raise ValueError("当前模型不包含这些分类阈值：" + "、".join(unknown))

    def _legacy_profile_capabilities(
        self,
        adapter_id: str,
        directory: Path,
        categories: dict[str, int],
    ) -> TaggerProfileCapabilities:
        try:
            if directory.is_dir():
                return self._registry.get(adapter_id).profile_capabilities(directory)
        except (OSError, ValueError):
            pass
        defaults = sorted(categories) or ["unknown"]
        return TaggerProfileCapabilities(
            supported_selection_modes=[TaggerSelectionMode.GLOBAL],
            default_selection=TaggerSelectionPolicy(),
            default_categories=defaults,
        )
