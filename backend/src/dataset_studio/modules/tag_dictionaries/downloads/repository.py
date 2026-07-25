from __future__ import annotations

from pathlib import Path

from dataset_studio.core.sqlite import connect, transaction
from dataset_studio.core.time import utc_now_iso
from dataset_studio.modules.tag_dictionaries.downloads.models import (
    ACTIVE_DICTIONARY_DOWNLOAD_STATUSES,
    RESUMABLE_DICTIONARY_DOWNLOAD_STATUSES,
    TagDictionaryDownloadStatus,
)

_PROCESSING_STATUSES = (
    TagDictionaryDownloadStatus.DOWNLOADING.value,
    TagDictionaryDownloadStatus.VERIFYING.value,
    TagDictionaryDownloadStatus.INSTALLING.value,
)


class TagDictionaryDownloadRepository:
    def __init__(self, database_path: Path) -> None:
        self._database_path = database_path

    def create(
        self,
        *,
        task_id: str,
        offer_id: str,
        offer_snapshot_json: str,
        dictionary_root: str,
        bytes_total: int,
        license_notice_hash: str,
        license_accepted_at: str,
    ):
        timestamp = utc_now_iso()
        with transaction(self._database_path) as connection:
            connection.execute(
                """
                INSERT INTO local_tag_dictionary_downloads (
                    id, offer_id, offer_snapshot_json, dictionary_root,
                    status, bytes_total, bytes_downloaded, stop_requested,
                    license_notice_hash, license_accepted_at,
                    created_at, updated_at
                ) VALUES (?, ?, ?, ?, 'queued', ?, 0, 0, ?, ?, ?, ?)
                """,
                (
                    task_id,
                    offer_id,
                    offer_snapshot_json,
                    dictionary_root,
                    bytes_total,
                    license_notice_hash,
                    license_accepted_at,
                    timestamp,
                    timestamp,
                ),
            )
            return connection.execute(
                "SELECT * FROM local_tag_dictionary_downloads WHERE id = ?",
                (task_id,),
            ).fetchone()

    def list(self):
        connection = connect(self._database_path)
        try:
            return connection.execute(
                """
                SELECT *
                FROM local_tag_dictionary_downloads
                ORDER BY created_at DESC, id DESC
                """
            ).fetchall()
        finally:
            connection.close()

    def get(self, task_id: str):
        connection = connect(self._database_path)
        try:
            return connection.execute(
                "SELECT * FROM local_tag_dictionary_downloads WHERE id = ?",
                (task_id,),
            ).fetchone()
        finally:
            connection.close()

    def active_for_offer(self, offer_id: str):
        connection = connect(self._database_path)
        try:
            placeholders = ", ".join("?" for _ in ACTIVE_DICTIONARY_DOWNLOAD_STATUSES)
            return connection.execute(
                f"""
                SELECT *
                FROM local_tag_dictionary_downloads
                WHERE offer_id = ? AND status IN ({placeholders})
                ORDER BY created_at DESC
                LIMIT 1
                """,
                (offer_id, *(status.value for status in ACTIVE_DICTIONARY_DOWNLOAD_STATUSES)),
            ).fetchone()
        finally:
            connection.close()

    def resumable_for_offer(self, offer_id: str):
        connection = connect(self._database_path)
        try:
            placeholders = ", ".join("?" for _ in RESUMABLE_DICTIONARY_DOWNLOAD_STATUSES)
            return connection.execute(
                f"""
                SELECT *
                FROM local_tag_dictionary_downloads
                WHERE offer_id = ? AND status IN ({placeholders})
                ORDER BY created_at DESC
                LIMIT 1
                """,
                (offer_id, *(status.value for status in RESUMABLE_DICTIONARY_DOWNLOAD_STATUSES)),
            ).fetchone()
        finally:
            connection.close()

    def claim_next(self, worker_id: str):
        timestamp = utc_now_iso()
        with transaction(self._database_path) as connection:
            placeholders = ", ".join("?" for _ in _PROCESSING_STATUSES)
            processing = connection.execute(
                f"""
                SELECT 1
                FROM local_tag_dictionary_downloads
                WHERE status IN ({placeholders})
                LIMIT 1
                """,
                _PROCESSING_STATUSES,
            ).fetchone()
            if processing is not None:
                return None
            row = connection.execute(
                """
                SELECT id
                FROM local_tag_dictionary_downloads
                WHERE status = 'queued'
                ORDER BY created_at, id
                LIMIT 1
                """
            ).fetchone()
            if row is None:
                return None
            task_id = str(row["id"])
            connection.execute(
                """
                UPDATE local_tag_dictionary_downloads
                SET status = 'downloading', worker_id = ?, stop_requested = 0,
                    started_at = COALESCE(started_at, ?), updated_at = ?
                WHERE id = ? AND status = 'queued'
                """,
                (worker_id, timestamp, timestamp, task_id),
            )
            return connection.execute(
                "SELECT * FROM local_tag_dictionary_downloads WHERE id = ?",
                (task_id,),
            ).fetchone()

    def request_pause(self, task_id: str):
        timestamp = utc_now_iso()
        with transaction(self._database_path) as connection:
            row = connection.execute(
                "SELECT status FROM local_tag_dictionary_downloads WHERE id = ?",
                (task_id,),
            ).fetchone()
            if row is None:
                return None
            status = TagDictionaryDownloadStatus(str(row["status"]))
            if status == TagDictionaryDownloadStatus.QUEUED:
                connection.execute(
                    """
                    UPDATE local_tag_dictionary_downloads
                    SET status = 'paused', stop_requested = 0, updated_at = ?
                    WHERE id = ?
                    """,
                    (timestamp, task_id),
                )
            elif status in {
                TagDictionaryDownloadStatus.DOWNLOADING,
                TagDictionaryDownloadStatus.VERIFYING,
                TagDictionaryDownloadStatus.INSTALLING,
            }:
                connection.execute(
                    """
                    UPDATE local_tag_dictionary_downloads
                    SET stop_requested = 1, updated_at = ?
                    WHERE id = ?
                    """,
                    (timestamp, task_id),
                )
            return connection.execute(
                "SELECT * FROM local_tag_dictionary_downloads WHERE id = ?",
                (task_id,),
            ).fetchone()

    def request_pause_all(self) -> int:
        timestamp = utc_now_iso()
        with transaction(self._database_path) as connection:
            queued = connection.execute(
                """
                UPDATE local_tag_dictionary_downloads
                SET status = 'paused', updated_at = ?
                WHERE status = 'queued'
                """,
                (timestamp,),
            ).rowcount
            active = connection.execute(
                """
                UPDATE local_tag_dictionary_downloads
                SET stop_requested = 1, updated_at = ?
                WHERE status IN ('downloading', 'verifying', 'installing')
                  AND stop_requested = 0
                """,
                (timestamp,),
            ).rowcount
            return queued + active

    def resume(self, task_id: str):
        timestamp = utc_now_iso()
        with transaction(self._database_path) as connection:
            placeholders = ", ".join("?" for _ in RESUMABLE_DICTIONARY_DOWNLOAD_STATUSES)
            connection.execute(
                f"""
                UPDATE local_tag_dictionary_downloads
                SET status = 'queued', stop_requested = 0, worker_id = NULL,
                    error_code = NULL, error_message = NULL, updated_at = ?
                WHERE id = ? AND status IN ({placeholders})
                """,
                (
                    timestamp,
                    task_id,
                    *(status.value for status in RESUMABLE_DICTIONARY_DOWNLOAD_STATUSES),
                ),
            )
            return connection.execute(
                "SELECT * FROM local_tag_dictionary_downloads WHERE id = ?",
                (task_id,),
            ).fetchone()

    def set_phase(self, task_id: str, status: TagDictionaryDownloadStatus) -> None:
        if status not in {
            TagDictionaryDownloadStatus.DOWNLOADING,
            TagDictionaryDownloadStatus.VERIFYING,
            TagDictionaryDownloadStatus.INSTALLING,
        }:
            raise ValueError("下载任务阶段无效。")
        with transaction(self._database_path) as connection:
            connection.execute(
                """
                UPDATE local_tag_dictionary_downloads
                SET status = ?, updated_at = ?
                WHERE id = ?
                """,
                (status.value, utc_now_iso(), task_id),
            )

    def update_progress(
        self,
        task_id: str,
        *,
        bytes_downloaded: int,
        current_file: str,
        speed_bps: float | None,
    ) -> None:
        with transaction(self._database_path) as connection:
            connection.execute(
                """
                UPDATE local_tag_dictionary_downloads
                SET bytes_downloaded = MIN(bytes_total, ?),
                    current_file = ?, speed_bps = ?, updated_at = ?
                WHERE id = ?
                """,
                (
                    max(0, bytes_downloaded),
                    current_file,
                    speed_bps,
                    utc_now_iso(),
                    task_id,
                ),
            )

    def complete(self, task_id: str, installation_id: str) -> None:
        timestamp = utc_now_iso()
        with transaction(self._database_path) as connection:
            connection.execute(
                """
                UPDATE local_tag_dictionary_downloads
                SET status = 'completed', bytes_downloaded = bytes_total,
                    installation_id = ?, stop_requested = 0, worker_id = NULL,
                    speed_bps = NULL, completed_at = ?, updated_at = ?
                WHERE id = ?
                """,
                (installation_id, timestamp, timestamp, task_id),
            )

    def fail(self, task_id: str, *, code: str, message: str) -> None:
        with transaction(self._database_path) as connection:
            connection.execute(
                """
                UPDATE local_tag_dictionary_downloads
                SET status = 'failed', error_code = ?, error_message = ?,
                    stop_requested = 0, worker_id = NULL, speed_bps = NULL,
                    updated_at = ?
                WHERE id = ?
                """,
                (code, message, utc_now_iso(), task_id),
            )

    def mark_paused(self, task_id: str) -> None:
        self._mark_stopped(task_id, TagDictionaryDownloadStatus.PAUSED)

    def mark_interrupted(self, task_id: str) -> None:
        self._mark_stopped(task_id, TagDictionaryDownloadStatus.INTERRUPTED)

    def _mark_stopped(self, task_id: str, status: TagDictionaryDownloadStatus) -> None:
        with transaction(self._database_path) as connection:
            connection.execute(
                """
                UPDATE local_tag_dictionary_downloads
                SET status = ?, stop_requested = 0, worker_id = NULL,
                    speed_bps = NULL, updated_at = ?
                WHERE id = ?
                """,
                (status.value, utc_now_iso(), task_id),
            )

    def recover_orphaned(self) -> int:
        with transaction(self._database_path) as connection:
            cursor = connection.execute(
                """
                UPDATE local_tag_dictionary_downloads
                SET status = 'interrupted', stop_requested = 0, worker_id = NULL,
                    speed_bps = NULL, updated_at = ?
                WHERE status IN ('downloading', 'verifying', 'installing')
                """,
                (utc_now_iso(),),
            )
            return cursor.rowcount

    def is_stop_requested(self, task_id: str) -> bool:
        connection = connect(self._database_path)
        try:
            row = connection.execute(
                """
                SELECT stop_requested
                FROM local_tag_dictionary_downloads
                WHERE id = ?
                """,
                (task_id,),
            ).fetchone()
            return bool(row and row["stop_requested"])
        finally:
            connection.close()

    def delete(self, task_id: str):
        with transaction(self._database_path) as connection:
            row = connection.execute(
                "SELECT * FROM local_tag_dictionary_downloads WHERE id = ?",
                (task_id,),
            ).fetchone()
            if row is None:
                return None
            status = TagDictionaryDownloadStatus(str(row["status"]))
            if status in ACTIVE_DICTIONARY_DOWNLOAD_STATUSES:
                raise ValueError("运行中的词典下载不能清理，请先暂停。")
            connection.execute(
                "DELETE FROM local_tag_dictionary_downloads WHERE id = ?",
                (task_id,),
            )
            return row

    def active_count(self) -> int:
        connection = connect(self._database_path)
        try:
            placeholders = ", ".join("?" for _ in ACTIVE_DICTIONARY_DOWNLOAD_STATUSES)
            row = connection.execute(
                f"""
                SELECT COUNT(*)
                FROM local_tag_dictionary_downloads
                WHERE status IN ({placeholders})
                """,
                tuple(status.value for status in ACTIVE_DICTIONARY_DOWNLOAD_STATUSES),
            ).fetchone()
            return int(row[0]) if row else 0
        finally:
            connection.close()
