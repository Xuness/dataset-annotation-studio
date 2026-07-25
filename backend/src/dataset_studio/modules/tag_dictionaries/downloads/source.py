from __future__ import annotations

import hashlib
import os
from collections.abc import Callable
from pathlib import Path
from urllib.parse import urlsplit

import httpx

from dataset_studio.modules.tag_dictionaries.downloads.models import (
    TagDictionaryDownloadOffer,
)

DictionaryProgressCallback = Callable[[int, str], None]
DictionaryStopCheck = Callable[[], bool]
_CHUNK_SIZE = 1024 * 1024


class DictionaryDownloadStopped(Exception):
    pass


class DictionarySourceError(ValueError):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


class DirectDictionarySource:
    def materialize(
        self,
        offer: TagDictionaryDownloadOffer,
        destination: Path,
        *,
        on_progress: DictionaryProgressCallback,
        should_stop: DictionaryStopCheck,
    ) -> Path:
        if (
            offer.download_url is None
            or offer.filename is None
            or offer.download_size is None
            or offer.sha256 is None
        ):
            raise DictionarySourceError(
                "invalid_catalog",
                "词典下载目录缺少固定文件信息。",
            )
        parsed = urlsplit(offer.download_url)
        if parsed.scheme != "https" or parsed.hostname not in {
            "github.com",
            "raw.githubusercontent.com",
        }:
            raise DictionarySourceError("unsafe_url", "词典下载地址不在允许的 HTTPS 上游。")
        destination = destination.resolve()
        destination.mkdir(parents=True, exist_ok=True)
        target = (destination / offer.filename).resolve()
        if target.parent != destination or target.is_symlink():
            raise DictionarySourceError("unsafe_path", "词典下载目标路径无效。")
        if _verified(target, offer, should_stop):
            on_progress(offer.download_size, offer.filename)
            return target

        partial = target.with_suffix(f"{target.suffix}.part")
        if partial.exists() and (partial.is_symlink() or not partial.is_file()):
            raise DictionarySourceError("unsafe_path", "词典下载暂存文件路径无效。")
        existing = partial.stat().st_size if partial.exists() else 0
        if existing > offer.download_size:
            partial.unlink()
            existing = 0
        headers = {
            "User-Agent": "DatasetAnnotationStudio/0.1",
            "Accept": "application/octet-stream",
        }
        if existing:
            headers["Range"] = f"bytes={existing}-"
        try:
            with (
                httpx.Client(
                    follow_redirects=True,
                    trust_env=True,
                    timeout=httpx.Timeout(60, read=60),
                ) as client,
                client.stream("GET", offer.download_url, headers=headers) as response,
            ):
                if response.status_code == 416 and existing == offer.download_size:
                    pass
                else:
                    response.raise_for_status()
                    append = existing > 0 and response.status_code == 206
                    if not append:
                        existing = 0
                    mode = "ab" if append else "wb"
                    with partial.open(mode) as handle:
                        downloaded = existing
                        on_progress(downloaded, offer.filename)
                        for chunk in response.iter_bytes(_CHUNK_SIZE):
                            _raise_if_stopped(should_stop)
                            if not chunk:
                                continue
                            handle.write(chunk)
                            downloaded += len(chunk)
                            if downloaded > offer.download_size:
                                raise DictionarySourceError(
                                    "size_mismatch",
                                    "上游返回的词典文件大于审核目录记录。",
                                )
                            on_progress(downloaded, offer.filename)
                        handle.flush()
                        os.fsync(handle.fileno())
        except DictionaryDownloadStopped:
            raise
        except DictionarySourceError:
            raise
        except httpx.ProxyError as error:
            raise DictionarySourceError(
                "proxy_error",
                "无法通过当前环境代理下载词典。",
            ) from error
        except httpx.TimeoutException as error:
            raise DictionarySourceError(
                "network_timeout",
                "词典下载超时，可稍后继续。",
            ) from error
        except httpx.HTTPStatusError as error:
            raise DictionarySourceError(
                "http_error",
                f"词典上游返回 HTTP {error.response.status_code}。",
            ) from error
        except httpx.HTTPError as error:
            raise DictionarySourceError(
                "network_error",
                "连接词典上游失败，可稍后继续。",
            ) from error
        if not _verified(partial, offer, should_stop):
            raise DictionarySourceError(
                "integrity_mismatch",
                "词典文件大小或 SHA-256 与审核目录不一致。",
            )
        os.replace(partial, target)
        on_progress(offer.download_size, offer.filename)
        return target


def verify_download(
    path: Path,
    offer: TagDictionaryDownloadOffer,
    should_stop: DictionaryStopCheck,
) -> None:
    if not _verified(path, offer, should_stop):
        raise DictionarySourceError(
            "integrity_mismatch",
            "词典文件大小或 SHA-256 与审核目录不一致。",
        )


def _verified(
    path: Path,
    offer: TagDictionaryDownloadOffer,
    should_stop: DictionaryStopCheck,
) -> bool:
    if (
        offer.download_size is None
        or offer.sha256 is None
        or not path.is_file()
        or path.is_symlink()
        or path.stat().st_size != offer.download_size
    ):
        return False
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while chunk := handle.read(8 * 1024 * 1024):
            _raise_if_stopped(should_stop)
            digest.update(chunk)
    return digest.hexdigest() == offer.sha256


def _raise_if_stopped(should_stop: DictionaryStopCheck) -> None:
    if should_stop():
        raise DictionaryDownloadStopped
