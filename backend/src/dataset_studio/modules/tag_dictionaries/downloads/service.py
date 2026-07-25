from __future__ import annotations

import hashlib
import json
import math
import shutil
import uuid
from pathlib import Path

from dataset_studio.core.time import utc_now_iso
from dataset_studio.modules.tag_dictionaries.downloads.catalog import (
    dictionary_download_offers,
)
from dataset_studio.modules.tag_dictionaries.downloads.models import (
    ACTIVE_DICTIONARY_DOWNLOAD_STATUSES,
    RESUMABLE_DICTIONARY_DOWNLOAD_STATUSES,
    TagDictionaryDownloadCenter,
    TagDictionaryDownloadCreate,
    TagDictionaryDownloadOffer,
    TagDictionaryDownloadStatus,
    TagDictionaryDownloadTask,
)
from dataset_studio.modules.tag_dictionaries.downloads.repository import (
    TagDictionaryDownloadRepository,
)
from dataset_studio.modules.tag_dictionaries.models import TagDictionaryDownloadMode
from dataset_studio.modules.tag_dictionaries.service import (
    TagDictionaryNotFoundError,
    TagDictionaryService,
)


class TagDictionaryDownloadService:
    def __init__(
        self,
        repository: TagDictionaryDownloadRepository,
        dictionaries: TagDictionaryService,
    ) -> None:
        self._repository = repository
        self._dictionaries = dictionaries
        self._offers = {offer.offer_id: offer for offer in dictionary_download_offers()}

    @property
    def repository(self) -> TagDictionaryDownloadRepository:
        return self._repository

    def center(self) -> TagDictionaryDownloadCenter:
        tasks = self.tasks()
        active_by_offer = {
            task.offer_id: task.id
            for task in tasks
            if task.status in ACTIVE_DICTIONARY_DOWNLOAD_STATUSES
        }
        offers: list[TagDictionaryDownloadOffer] = []
        for configured in self._offers.values():
            installed = self._dictionaries.find_by_source(
                configured.source_id,
                configured.source_version,
            )
            offers.append(
                configured.model_copy(
                    update={
                        "installed_installation_id": installed.id if installed else None,
                        "active_download_id": active_by_offer.get(configured.offer_id),
                    }
                )
            )
        return TagDictionaryDownloadCenter(offers=offers, tasks=tasks)

    def tasks(self) -> list[TagDictionaryDownloadTask]:
        return [self._task_from_row(row) for row in self._repository.list()]

    def create(self, data: TagDictionaryDownloadCreate) -> TagDictionaryDownloadTask:
        offer = self.get_offer(data.offer_id)
        if offer.download_mode != TagDictionaryDownloadMode.DIRECT:
            raise ValueError("该词典授权尚不明确，请从来源页下载后使用本地导入。")
        if not data.license_accepted:
            raise ValueError("下载前必须阅读并确认该词典的许可证与来源说明。")
        if (
            offer.download_url is None
            or offer.filename is None
            or offer.download_size is None
            or offer.sha256 is None
        ):
            raise ValueError("词典下载目录缺少经过审核的文件信息。")
        with self._dictionaries.catalog_guard():
            installed = self._dictionaries.find_by_source(
                offer.source_id,
                offer.source_version,
            )
            if installed is not None:
                raise ValueError("这个词典版本已经安装，无需重复下载。")
            active = self._repository.active_for_offer(offer.offer_id)
            if active is not None:
                return self._task_from_row(active)
            if self._repository.resumable_for_offer(offer.offer_id) is not None:
                raise ValueError("这个词典已有可恢复的下载任务，请继续或清理该任务。")
            root = self._dictionaries.dictionary_root()
            root.mkdir(parents=True, exist_ok=True)
            accepted_at = utc_now_iso()
            row = self._repository.create(
                task_id=str(uuid.uuid4()),
                offer_id=offer.offer_id,
                offer_snapshot_json=offer.model_dump_json(),
                dictionary_root=str(root),
                bytes_total=offer.download_size,
                license_notice_hash=self.license_notice_hash(offer),
                license_accepted_at=accepted_at,
            )
        return self._task_from_row(row)

    def pause(self, task_id: str) -> TagDictionaryDownloadTask:
        row = self._repository.request_pause(task_id)
        if row is None:
            raise TagDictionaryNotFoundError(f"找不到词典下载任务：{task_id}")
        return self._task_from_row(row)

    def resume(self, task_id: str) -> TagDictionaryDownloadTask:
        row = self._repository.resume(task_id)
        if row is None:
            raise TagDictionaryNotFoundError(f"找不到词典下载任务：{task_id}")
        return self._task_from_row(row)

    def delete(self, task_id: str) -> TagDictionaryDownloadCenter:
        row = self._repository.delete(task_id)
        if row is None:
            raise TagDictionaryNotFoundError(f"找不到词典下载任务：{task_id}")
        self.cleanup_staging(row)
        return self.center()

    def active_count(self) -> int:
        return self._repository.active_count()

    def pause_all(self) -> int:
        return self._repository.request_pause_all()

    def get_offer(self, offer_id: str) -> TagDictionaryDownloadOffer:
        try:
            return self._offers[offer_id].model_copy(deep=True)
        except KeyError as error:
            raise ValueError(f"未知的词典下载目录项：{offer_id}") from error

    def offer_from_row(self, row) -> TagDictionaryDownloadOffer:
        try:
            offer = TagDictionaryDownloadOffer.model_validate_json(str(row["offer_snapshot_json"]))
        except ValueError as error:
            raise ValueError("词典下载任务快照无效。") from error
        if offer.download_mode != TagDictionaryDownloadMode.DIRECT:
            raise ValueError("词典下载任务不是可执行的上游直连计划。")
        if self.license_notice_hash(offer) != str(row["license_notice_hash"]):
            raise ValueError("词典下载任务的许可证告知快照校验失败。")
        return offer

    def staging_path(self, row) -> Path:
        root = Path(str(row["dictionary_root"])).resolve()
        current = self._dictionaries.dictionary_root().resolve()
        if root != current:
            raise ValueError("下载任务的词典目录与当前设置不一致。")
        staging_root = (root / ".downloads").resolve()
        if not staging_root.is_relative_to(root):
            raise ValueError("词典下载暂存根目录无效。")
        staging = (staging_root / str(row["id"])).resolve()
        if staging.parent != staging_root:
            raise ValueError("词典下载暂存路径无效。")
        return staging

    def cleanup_staging(self, row) -> None:
        staging = self.staging_path(row)
        if staging.exists():
            if staging.is_symlink() or not staging.is_dir():
                raise ValueError("词典下载暂存路径不安全。")
            shutil.rmtree(staging)

    @staticmethod
    def license_notice_hash(offer: TagDictionaryDownloadOffer) -> str:
        payload = json.dumps(
            {
                "offer_id": offer.offer_id,
                "source_url": offer.source_url,
                "source_version": offer.source_version,
                "license_id": offer.license_id,
                "license_url": offer.license_url,
                "license_status": offer.license_status.value,
                "license_notice": offer.license_notice,
            },
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        )
        return hashlib.sha256(payload.encode("utf-8")).hexdigest()

    @staticmethod
    def _task_from_row(row) -> TagDictionaryDownloadTask:
        offer = TagDictionaryDownloadOffer.model_validate_json(str(row["offer_snapshot_json"]))
        status = TagDictionaryDownloadStatus(str(row["status"]))
        speed = float(row["speed_bps"]) if row["speed_bps"] is not None else None
        remaining = max(0, int(row["bytes_total"]) - int(row["bytes_downloaded"]))
        eta = (
            max(0, math.ceil(remaining / speed))
            if speed is not None and math.isfinite(speed) and speed > 0
            else None
        )
        return TagDictionaryDownloadTask(
            id=str(row["id"]),
            offer_id=str(row["offer_id"]),
            offer_name=offer.name,
            adapter_id=offer.adapter_id,
            source_id=offer.source_id,
            source_version=offer.source_version,
            revision=offer.revision,
            dictionary_root=str(row["dictionary_root"]),
            status=status,
            bytes_total=int(row["bytes_total"]),
            bytes_downloaded=min(int(row["bytes_downloaded"]), int(row["bytes_total"])),
            current_file=str(row["current_file"]) if row["current_file"] else None,
            speed_bps=speed if speed is None or math.isfinite(speed) else None,
            eta_seconds=eta,
            stop_requested=bool(row["stop_requested"]),
            installation_id=str(row["installation_id"]) if row["installation_id"] else None,
            error_code=str(row["error_code"]) if row["error_code"] else None,
            error_message=str(row["error_message"]) if row["error_message"] else None,
            can_pause=status
            in {
                TagDictionaryDownloadStatus.QUEUED,
                TagDictionaryDownloadStatus.DOWNLOADING,
            }
            and not bool(row["stop_requested"]),
            can_resume=status in RESUMABLE_DICTIONARY_DOWNLOAD_STATUSES,
            can_delete=status not in ACTIVE_DICTIONARY_DOWNLOAD_STATUSES,
            created_at=str(row["created_at"]),
            started_at=str(row["started_at"]) if row["started_at"] else None,
            completed_at=str(row["completed_at"]) if row["completed_at"] else None,
            updated_at=str(row["updated_at"]),
        )
