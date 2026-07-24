from __future__ import annotations

import json
import os
import shutil
import stat
import time
import uuid
from dataclasses import asdict
from pathlib import Path
from urllib.parse import urlsplit

import httpx

from dataset_studio.core.errors import SecretStoreUnavailableError, TaggerNotFoundError
from dataset_studio.modules.taggers.downloads.models import (
    ACTIVE_DOWNLOAD_STATUSES,
    RESUMABLE_DOWNLOAD_STATUSES,
    HuggingFaceConnectionSettings,
    HuggingFaceConnectionTest,
    HuggingFaceProxyMode,
    HuggingFaceSettingsUpdate,
    TaggerDownloadCenter,
    TaggerDownloadCreate,
    TaggerDownloadOffer,
    TaggerDownloadStatus,
    TaggerDownloadTask,
)
from dataset_studio.modules.taggers.downloads.repository import TaggerDownloadRepository
from dataset_studio.modules.taggers.models import TaggerInstallation, TaggerInstallationStatus
from dataset_studio.modules.taggers.service import TaggerService
from dataset_studio.modules.taggers.sources.base import (
    TaggerDownloadPlan,
    TaggerRemoteFile,
)
from dataset_studio.modules.taggers.sources.huggingface import (
    HuggingFaceClientConfig,
    HuggingFaceModelSource,
    resolve_huggingface_login_token,
)
from dataset_studio.platform.secrets import SecretStore

_TOKEN_SECRET_KEY = "local-tagger:huggingface:token"
_PROXY_SECRET_KEY = "local-tagger:huggingface:proxy"
_PUBLIC_TEST_URL = "https://huggingface.co/api/models/{repo}/revision/{revision}"
_WHOAMI_URL = "https://huggingface.co/api/whoami-v2"


class TaggerDownloadService:
    def __init__(
        self,
        repository: TaggerDownloadRepository,
        taggers: TaggerService,
        secrets: SecretStore,
    ) -> None:
        self._repository = repository
        self._taggers = taggers
        self._secrets = secrets

    @property
    def repository(self) -> TaggerDownloadRepository:
        return self._repository

    def center(self) -> TaggerDownloadCenter:
        library = self._taggers.library()
        tasks = self.tasks()
        active_by_plan = {
            task.plan_id: task.id
            for task in reversed(tasks)
            if task.status in ACTIVE_DOWNLOAD_STATUSES
        }
        adapters = {adapter.id: adapter.name for adapter in library.supported_adapters}
        offers = [
            self._offer(
                plan,
                adapters.get(plan.adapter_id, plan.adapter_id),
                library.installations,
                active_by_plan.get(plan.plan_id),
            )
            for plan in self._taggers.registry.download_plans()
        ]
        return TaggerDownloadCenter(
            offers=offers,
            tasks=tasks,
        )

    def tasks(self) -> list[TaggerDownloadTask]:
        return [self._task_from_row(row) for row in self._repository.list()]

    def connection_settings(self) -> HuggingFaceConnectionSettings:
        credential_store_error: str | None = None
        try:
            saved_token = self._secrets.get(_TOKEN_SECRET_KEY)
            saved_proxy = self._secrets.get(_PROXY_SECRET_KEY)
        except SecretStoreUnavailableError as error:
            saved_token = None
            saved_proxy = None
            credential_store_error = str(error)
        _, token_source = resolve_huggingface_login_token(saved_token)
        proxy_mode = self._repository.get_proxy_mode()
        return HuggingFaceConnectionSettings(
            token_source=token_source,
            has_saved_token=bool(saved_token),
            proxy_mode=proxy_mode,
            has_custom_proxy=bool(saved_proxy),
            proxy_display=self._proxy_display(proxy_mode, saved_proxy),
            credential_store_available=credential_store_error is None,
            credential_store_error=credential_store_error,
        )

    def update_connection_settings(
        self,
        data: HuggingFaceSettingsUpdate,
    ) -> HuggingFaceConnectionSettings:
        secret_store_available = True
        try:
            old_token = self._secrets.get(_TOKEN_SECRET_KEY)
            old_proxy = self._secrets.get(_PROXY_SECRET_KEY)
        except SecretStoreUnavailableError:
            secret_store_available = False
            old_token = None
            old_proxy = None
            if (
                data.token is not None
                or data.clear_token
                or data.proxy_url is not None
                or data.clear_proxy
                or data.proxy_mode == HuggingFaceProxyMode.CUSTOM
            ):
                raise
        old_mode = self._repository.get_proxy_mode()
        new_proxy = (
            None
            if data.clear_proxy
            else data.proxy_url
            if data.proxy_url is not None
            else old_proxy
        )
        if data.proxy_mode == HuggingFaceProxyMode.CUSTOM and not new_proxy:
            raise ValueError("自定义代理模式需要先保存代理地址。")

        try:
            if data.clear_token:
                self._secrets.delete(_TOKEN_SECRET_KEY)
            elif data.token is not None:
                self._secrets.set(_TOKEN_SECRET_KEY, data.token)
            if data.clear_proxy:
                self._secrets.delete(_PROXY_SECRET_KEY)
            elif data.proxy_url is not None:
                self._secrets.set(_PROXY_SECRET_KEY, data.proxy_url)
            self._repository.set_proxy_mode(data.proxy_mode)
        except BaseException:
            if secret_store_available:
                self._restore_secret(_TOKEN_SECRET_KEY, old_token)
                self._restore_secret(_PROXY_SECRET_KEY, old_proxy)
            if self._repository.get_proxy_mode() != old_mode:
                self._repository.set_proxy_mode(old_mode)
            raise
        return self.connection_settings()

    def test_connection(self) -> HuggingFaceConnectionTest:
        config, token_source = self._client_config()
        started = time.monotonic()
        username: str | None = None
        connected = False
        message = ""
        try:
            headers = (
                {"Authorization": f"Bearer {config.token}"} if config.token is not None else {}
            )
            with config.create_httpx_client() as client:
                if config.token is not None:
                    response = client.get(_WHOAMI_URL, headers=headers)
                else:
                    plan = next(
                        plan for plan in self._taggers.registry.download_plans() if not plan.gated
                    )
                    response = client.get(
                        _PUBLIC_TEST_URL.format(
                            repo=plan.source_id,
                            revision=plan.revision,
                        ),
                        headers=headers,
                    )
                response.raise_for_status()
                if config.token is not None:
                    payload = response.json()
                    raw_name = payload.get("name") if isinstance(payload, dict) else None
                    username = str(raw_name) if raw_name else None
            connected = True
            message = (
                f"已使用 Hugging Face 身份 {username} 连接。"
                if username
                else "已连接 Hugging Face 公共模型服务。"
            )
        except httpx.ProxyError:
            message = "无法通过当前代理连接 Hugging Face。"
        except httpx.TimeoutException:
            message = "连接 Hugging Face 超时。"
        except httpx.HTTPStatusError as error:
            if error.response.status_code in {401, 403}:
                message = "Hugging Face 凭据无效或没有访问权限。"
            else:
                message = f"Hugging Face 返回 HTTP {error.response.status_code}。"
        except (httpx.HTTPError, ValueError):
            message = "连接 Hugging Face 失败，请检查网络与代理设置。"
        latency_ms = max(0, round((time.monotonic() - started) * 1000))
        return HuggingFaceConnectionTest(
            connected=connected,
            username=username,
            token_source=token_source,
            proxy_mode=config.proxy_mode,
            proxy_display=self._proxy_display(config.proxy_mode, config.proxy_url),
            latency_ms=latency_ms,
            message=message,
        )

    def create(self, data: TaggerDownloadCreate) -> TaggerDownloadTask:
        plan = self._taggers.registry.get_download_plan(data.plan_id)
        if not data.license_accepted:
            raise ValueError("下载前必须确认已阅读并接受该模型自己的许可证。")
        with self._taggers.catalog_guard():
            if self.find_matching_installation(plan) is not None:
                raise ValueError("这个审核版本已经安装，无需重复下载。")
            active = self._repository.active_for_plan(plan.plan_id)
            if active is not None:
                return self._task_from_row(active)
            resumable = self._repository.resumable_for_plan(plan.plan_id)
            if resumable is not None:
                raise ValueError("这个模型已有可恢复的下载任务，请继续或清理该任务。")
            root = self._taggers.model_root()
            root.mkdir(parents=True, exist_ok=True)
            row = self._repository.create(
                task_id=str(uuid.uuid4()),
                plan_id=plan.plan_id,
                plan_snapshot_json=self.serialize_plan(plan),
                adapter_id=plan.adapter_id,
                repo_id=plan.source_id,
                revision=plan.revision,
                model_root=str(root),
                bytes_total=plan.download_size,
                files_total=len(plan.files),
            )
        return self._task_from_row(row)

    def pause(self, task_id: str) -> TaggerDownloadTask:
        row = self._repository.request_pause(task_id)
        if row is None:
            raise TaggerNotFoundError(f"找不到打标器下载任务：{task_id}")
        return self._task_from_row(row)

    def active_count(self) -> int:
        return self._repository.active_count()

    def pause_all(self) -> int:
        return self._repository.request_pause_all()

    def resume(self, task_id: str) -> TaggerDownloadTask:
        row = self._repository.resume(task_id)
        if row is None:
            raise TaggerNotFoundError(f"找不到打标器下载任务：{task_id}")
        return self._task_from_row(row)

    def delete(self, task_id: str) -> TaggerDownloadCenter:
        row = self._repository.delete(
            task_id,
            before_delete=self.cleanup_staging,
        )
        if row is None:
            raise TaggerNotFoundError(f"找不到打标器下载任务：{task_id}")
        return self.center()

    def source(self) -> HuggingFaceModelSource:
        config, _ = self._client_config()
        return HuggingFaceModelSource(config)

    def find_matching_installation(
        self,
        plan: TaggerDownloadPlan,
        installations: list[TaggerInstallation] | None = None,
    ) -> TaggerInstallation | None:
        candidates = (
            installations if installations is not None else self._taggers.library().installations
        )
        expected = {file.relative_path: (file.size, file.sha256) for file in plan.files}
        for installation in candidates:
            if (
                installation.status != TaggerInstallationStatus.READY
                or installation.adapter_id != plan.adapter_id
            ):
                continue
            installed = {
                file.relative_path: (file.size, file.sha256) for file in installation.files
            }
            if installed == expected:
                return installation
        return None

    def plan_from_row(self, row) -> TaggerDownloadPlan:
        try:
            payload = json.loads(str(row["plan_snapshot_json"]))
            raw_files = payload.pop("files")
            payload.setdefault("license_id", "NOASSERTION")
            payload.setdefault("license_url", payload.get("source_url"))
            plan = TaggerDownloadPlan(
                **payload,
                files=tuple(TaggerRemoteFile(**file) for file in raw_files),
            )
        except (KeyError, TypeError, ValueError, json.JSONDecodeError) as error:
            raise ValueError("下载任务中的审核计划快照无效。") from error
        if (
            plan.plan_id != str(row["plan_id"])
            or plan.adapter_id != str(row["adapter_id"])
            or plan.source_id != str(row["repo_id"])
            or plan.revision != str(row["revision"])
        ):
            raise ValueError("下载任务记录与审核计划快照不一致。")
        return plan

    def staging_path(self, row) -> Path:
        root = Path(str(row["model_root"])).resolve()
        staging_root_candidate = root / ".downloads"
        if self._is_directory_link(staging_root_candidate):
            raise ValueError("下载暂存根目录不能是符号链接或目录联接。")
        if staging_root_candidate.exists() and not staging_root_candidate.is_dir():
            raise ValueError("下载暂存根路径不是文件夹。")
        staging_root = staging_root_candidate.resolve()
        if not staging_root.is_relative_to(root):
            raise ValueError("下载暂存根目录超出模型库。")
        staging_candidate = staging_root / str(row["id"])
        if self._is_directory_link(staging_candidate):
            raise ValueError("下载任务暂存目录不能是符号链接或目录联接。")
        if staging_candidate.exists() and not staging_candidate.is_dir():
            raise ValueError("下载任务暂存路径不是文件夹。")
        staging = staging_candidate.resolve()
        if staging.parent != staging_root:
            raise ValueError("下载任务暂存路径无效。")
        return staging

    def cleanup_staging(self, row) -> None:
        staging = self.staging_path(row)
        if staging.exists():
            shutil.rmtree(staging)

    @staticmethod
    def _is_directory_link(path: Path) -> bool:
        is_junction = getattr(path, "is_junction", None)
        if path.is_symlink() or (is_junction is not None and is_junction()):
            return True
        try:
            attributes = int(getattr(path.lstat(), "st_file_attributes", 0))
        except OSError:
            return False
        reparse_flag = int(getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0))
        return bool(reparse_flag and attributes & reparse_flag)

    @staticmethod
    def serialize_plan(plan: TaggerDownloadPlan) -> str:
        return json.dumps(
            asdict(plan),
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        )

    def _offer(
        self,
        plan: TaggerDownloadPlan,
        adapter_name: str,
        installations: list[TaggerInstallation],
        active_download_id: str | None,
    ) -> TaggerDownloadOffer:
        installed = self.find_matching_installation(plan, installations)
        return TaggerDownloadOffer(
            plan_id=plan.plan_id,
            adapter_id=plan.adapter_id,
            adapter_name=adapter_name,
            name=plan.name,
            model_version=plan.model_version,
            description=plan.description,
            repo_id=plan.source_id,
            revision=plan.revision,
            source_url=plan.source_url,
            license_id=plan.license_id,
            license_url=plan.license_url,
            gated=plan.gated,
            provenance=plan.provenance,
            download_size=plan.download_size,
            file_count=len(plan.files),
            installed_installation_id=installed.id if installed is not None else None,
            installed_installation_name=installed.name if installed is not None else None,
            active_download_id=active_download_id,
        )

    def _task_from_row(self, row) -> TaggerDownloadTask:
        status = TaggerDownloadStatus(str(row["status"]))
        speed = float(row["speed_bps"]) if row["speed_bps"] is not None else None
        remaining = max(0, int(row["bytes_total"]) - int(row["bytes_downloaded"]))
        eta = round(remaining / speed) if speed and speed > 0 else None
        try:
            plan_name = self.plan_from_row(row).name
        except ValueError:
            plan_name = str(row["plan_id"])
        stop_requested = bool(row["stop_requested"])
        return TaggerDownloadTask(
            id=str(row["id"]),
            plan_id=str(row["plan_id"]),
            plan_name=plan_name,
            adapter_id=str(row["adapter_id"]),
            repo_id=str(row["repo_id"]),
            revision=str(row["revision"]),
            model_root=str(row["model_root"]),
            status=status,
            bytes_total=int(row["bytes_total"]),
            bytes_downloaded=int(row["bytes_downloaded"]),
            files_total=int(row["files_total"]),
            files_completed=int(row["files_completed"]),
            current_file=str(row["current_file"]) if row["current_file"] else None,
            speed_bps=speed,
            eta_seconds=eta,
            stop_requested=stop_requested,
            installation_id=(str(row["installation_id"]) if row["installation_id"] else None),
            error_code=str(row["error_code"]) if row["error_code"] else None,
            error_message=str(row["error_message"]) if row["error_message"] else None,
            can_pause=status in ACTIVE_DOWNLOAD_STATUSES and not stop_requested,
            can_resume=status in RESUMABLE_DOWNLOAD_STATUSES,
            can_delete=status not in ACTIVE_DOWNLOAD_STATUSES,
            created_at=str(row["created_at"]),
            started_at=str(row["started_at"]) if row["started_at"] else None,
            completed_at=str(row["completed_at"]) if row["completed_at"] else None,
            updated_at=str(row["updated_at"]),
        )

    def _client_config(self) -> tuple[HuggingFaceClientConfig, str]:
        credential_store_error: SecretStoreUnavailableError | None = None
        try:
            app_token = self._secrets.get(_TOKEN_SECRET_KEY)
            proxy_url = self._secrets.get(_PROXY_SECRET_KEY)
        except SecretStoreUnavailableError as error:
            app_token = None
            proxy_url = None
            credential_store_error = error
        token, token_source = resolve_huggingface_login_token(app_token)
        mode = self._repository.get_proxy_mode()
        if mode == HuggingFaceProxyMode.CUSTOM and not proxy_url:
            if credential_store_error is not None:
                raise credential_store_error
            raise ValueError("自定义代理模式尚未保存代理地址。")
        return (
            HuggingFaceClientConfig(
                token=token,
                proxy_mode=mode,
                proxy_url=proxy_url if mode == HuggingFaceProxyMode.CUSTOM else None,
            ),
            token_source,
        )

    @staticmethod
    def _proxy_display(
        mode: HuggingFaceProxyMode,
        custom_proxy: str | None,
    ) -> str | None:
        if mode == HuggingFaceProxyMode.DIRECT:
            return None
        candidate = custom_proxy
        if mode == HuggingFaceProxyMode.ENVIRONMENT:
            candidate = next(
                (
                    os.environ[name]
                    for name in (
                        "HTTPS_PROXY",
                        "https_proxy",
                        "HTTP_PROXY",
                        "http_proxy",
                        "ALL_PROXY",
                        "all_proxy",
                    )
                    if os.environ.get(name)
                ),
                None,
            )
        if not candidate:
            return None
        parsed = urlsplit(candidate)
        if not parsed.scheme or not parsed.hostname:
            return "环境代理"
        port = f":{parsed.port}" if parsed.port is not None else ""
        return f"{parsed.scheme}://{parsed.hostname}{port}"

    def _restore_secret(self, key: str, value: str | None) -> None:
        if value is None:
            self._secrets.delete(key)
        else:
            self._secrets.set(key, value)
