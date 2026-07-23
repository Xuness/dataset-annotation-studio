from __future__ import annotations

import hashlib
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import httpx
from huggingface_hub import (
    HfApi,
    close_session,
    get_token,
    hf_hub_download,
    set_client_factory,
)
from huggingface_hub.errors import GatedRepoError, HfHubHTTPError
from huggingface_hub.utils import tqdm as hf_tqdm

from dataset_studio.modules.taggers.downloads.models import HuggingFaceProxyMode
from dataset_studio.modules.taggers.sources.base import (
    TaggerDownloadPlan,
    TaggerDownloadStopped,
    TaggerMaterializedFile,
    TaggerMaterializedModel,
    TaggerProgressCallback,
    TaggerRemoteFile,
    TaggerSourceError,
    TaggerStopCheck,
    TaggerTransferProgress,
)

_HASH_CHUNK_SIZE = 8 * 1024 * 1024


@dataclass(frozen=True, slots=True)
class HuggingFaceClientConfig:
    token: str | None
    proxy_mode: HuggingFaceProxyMode
    proxy_url: str | None

    def create_httpx_client(self) -> httpx.Client:
        proxy = self.proxy_url if self.proxy_mode == HuggingFaceProxyMode.CUSTOM else None
        return httpx.Client(
            proxy=proxy,
            trust_env=self.proxy_mode == HuggingFaceProxyMode.ENVIRONMENT,
            follow_redirects=True,
            timeout=httpx.Timeout(60, read=60),
        )

    def configure_process_client(self) -> None:
        def client_factory() -> httpx.Client:
            return self.create_httpx_client()

        close_session()
        set_client_factory(client_factory)


class HuggingFaceModelSource:
    source_type = "huggingface"

    def __init__(self, config: HuggingFaceClientConfig) -> None:
        self._config = config

    def preflight(self, plan: TaggerDownloadPlan) -> None:
        self._config.configure_process_client()
        try:
            info = HfApi(token=self._config.token).model_info(
                plan.source_id,
                revision=plan.revision,
            )
        except Exception as error:
            raise _source_error(error, plan) from error
        if info.sha != plan.revision:
            raise TaggerSourceError(
                "revision_mismatch",
                "Hugging Face 返回的模型 revision 与审核计划不一致，已停止下载。",
            )

    def materialize(
        self,
        plan: TaggerDownloadPlan,
        destination: Path,
        *,
        on_progress: TaggerProgressCallback,
        should_stop: TaggerStopCheck,
    ) -> TaggerMaterializedModel:
        self._config.configure_process_client()
        destination = destination.resolve()
        hub_root = (destination / ".hub").resolve()
        payload_root = (destination / "payload").resolve()
        if not hub_root.is_relative_to(destination) or not payload_root.is_relative_to(destination):
            raise ValueError("打标器下载暂存路径无效。")
        hub_root.mkdir(parents=True, exist_ok=True)
        payload_root.mkdir(parents=True, exist_ok=True)

        materialized: list[TaggerMaterializedFile] = []
        completed_bytes = 0
        for index, file in enumerate(plan.files):
            _raise_if_stopped(should_stop)
            target = (payload_root / file.relative_path).resolve()
            if not target.is_relative_to(payload_root):
                raise ValueError(f"打标器下载目标路径无效：{file.relative_path}")
            existing = _verified_file(target, file, should_stop)
            if existing is not None:
                materialized.append(existing)
                completed_bytes += file.size
                on_progress(
                    TaggerTransferProgress(
                        relative_path=file.relative_path,
                        bytes_downloaded=completed_bytes,
                        bytes_total=plan.download_size,
                        files_completed=index + 1,
                        files_total=len(plan.files),
                    )
                )
                continue

            progress_class = _reporting_tqdm(
                file=file,
                completed_bytes=completed_bytes,
                completed_files=index,
                plan=plan,
                on_progress=on_progress,
                should_stop=should_stop,
            )
            try:
                downloaded = Path(
                    hf_hub_download(
                        repo_id=plan.source_id,
                        filename=file.remote_path,
                        revision=plan.revision,
                        local_dir=hub_root,
                        token=self._config.token,
                        tqdm_class=progress_class,
                    )
                ).resolve()
            except TaggerDownloadStopped:
                raise
            except Exception as error:
                raise _source_error(error, plan) from error
            if not downloaded.is_relative_to(hub_root) or not downloaded.is_file():
                raise TaggerSourceError(
                    "unsafe_download_path",
                    f"Hugging Face 返回了无效的本地文件路径：{file.remote_path}",
                )

            verified = _verified_file(downloaded, file, should_stop)
            if verified is None:
                downloaded.unlink(missing_ok=True)
                raise TaggerSourceError(
                    "integrity_mismatch",
                    f"下载文件完整性校验失败：{file.relative_path}",
                )
            target.parent.mkdir(parents=True, exist_ok=True)
            if target.exists():
                target.unlink()
            os.replace(downloaded, target)
            stat = target.stat()
            materialized.append(
                TaggerMaterializedFile(
                    relative_path=file.relative_path,
                    size=stat.st_size,
                    modified_ns=stat.st_mtime_ns,
                    sha256=file.sha256,
                )
            )
            completed_bytes += file.size
            on_progress(
                TaggerTransferProgress(
                    relative_path=file.relative_path,
                    bytes_downloaded=completed_bytes,
                    bytes_total=plan.download_size,
                    files_completed=index + 1,
                    files_total=len(plan.files),
                )
            )

        return TaggerMaterializedModel(directory=payload_root, files=tuple(materialized))


def resolve_huggingface_login_token(app_token: str | None) -> tuple[str | None, str]:
    if app_token:
        return app_token, "app"
    environment_token = os.environ.get("HF_TOKEN", "").strip()
    if environment_token:
        return environment_token, "environment"
    local_token = get_token()
    if local_token:
        return local_token, "local_login"
    return None, "anonymous"


def _reporting_tqdm(
    *,
    file: TaggerRemoteFile,
    completed_bytes: int,
    completed_files: int,
    plan: TaggerDownloadPlan,
    on_progress: TaggerProgressCallback,
    should_stop: TaggerStopCheck,
):
    class ReportingTqdm(hf_tqdm):
        def __init__(self, *args: Any, **kwargs: Any) -> None:
            super().__init__(*args, **kwargs)
            self._report()

        def update(self, n: int | float = 1) -> bool | None:
            _raise_if_stopped(should_stop)
            updated = super().update(n)
            self._report()
            return updated

        def _report(self) -> None:
            current = min(file.size, max(0, int(self.n)))
            on_progress(
                TaggerTransferProgress(
                    relative_path=file.relative_path,
                    bytes_downloaded=min(plan.download_size, completed_bytes + current),
                    bytes_total=plan.download_size,
                    files_completed=completed_files,
                    files_total=len(plan.files),
                )
            )

    return ReportingTqdm


def _verified_file(
    path: Path,
    expected: TaggerRemoteFile,
    should_stop: TaggerStopCheck,
) -> TaggerMaterializedFile | None:
    if not path.is_file() or path.is_symlink():
        return None
    stat = path.stat()
    if stat.st_size != expected.size:
        return None
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while chunk := handle.read(_HASH_CHUNK_SIZE):
            _raise_if_stopped(should_stop)
            digest.update(chunk)
    if digest.hexdigest() != expected.sha256:
        return None
    return TaggerMaterializedFile(
        relative_path=expected.relative_path,
        size=stat.st_size,
        modified_ns=stat.st_mtime_ns,
        sha256=expected.sha256,
    )


def _raise_if_stopped(should_stop: TaggerStopCheck) -> None:
    if should_stop():
        raise TaggerDownloadStopped


def _source_error(error: Exception, plan: TaggerDownloadPlan) -> TaggerSourceError:
    if isinstance(error, GatedRepoError):
        return TaggerSourceError(
            "gated_access",
            f"当前 Hugging Face 凭据尚未获得 {plan.source_id} 的门控访问权限。",
        )
    if isinstance(error, httpx.ProxyError):
        return TaggerSourceError("proxy_error", "无法通过当前代理连接 Hugging Face。")
    if isinstance(error, httpx.TimeoutException):
        return TaggerSourceError("network_timeout", "连接 Hugging Face 超时，可稍后继续下载。")
    if isinstance(error, HfHubHTTPError):
        status = error.response.status_code if error.response is not None else None
        if status in {401, 403}:
            return TaggerSourceError(
                "authentication_error",
                "Hugging Face 凭据无效或没有读取该仓库的权限。",
            )
        return TaggerSourceError(
            "hub_error",
            f"Hugging Face 请求失败（{status or 'unknown'}）。",
        )
    if isinstance(error, httpx.HTTPError):
        return TaggerSourceError("network_error", "连接 Hugging Face 失败，可稍后继续下载。")
    return TaggerSourceError("download_error", str(error) or type(error).__name__)
