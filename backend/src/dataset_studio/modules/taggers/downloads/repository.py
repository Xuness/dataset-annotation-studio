from __future__ import annotations

import sqlite3
from pathlib import Path

from dataset_studio.core.sqlite import connect, transaction
from dataset_studio.core.time import utc_now_iso
from dataset_studio.modules.taggers.downloads.models import (
    ACTIVE_DOWNLOAD_STATUSES,
    RESUMABLE_DOWNLOAD_STATUSES,
    HuggingFaceProxyMode,
    TaggerDownloadStatus,
)

_ACTIVE_VALUES = tuple(status.value for status in ACTIVE_DOWNLOAD_STATUSES)
_RESUMABLE_VALUES = tuple(status.value for status in RESUMABLE_DOWNLOAD_STATUSES)


class TaggerDownloadRepository:
    def __init__(self, database_path: Path) -> None:
        self._database_path = database_path

    @property
    def database_path(self) -> Path:
        return self._database_path

    def get_proxy_mode(self) -> HuggingFaceProxyMode:
        connection = connect(self._database_path)
        try:
            row = connection.execute(
                "SELECT proxy_mode FROM local_tagger_hf_settings WHERE id = 1"
            ).fetchone()
            return (
                HuggingFaceProxyMode(str(row["proxy_mode"]))
                if row is not None
                else HuggingFaceProxyMode.ENVIRONMENT
            )
        finally:
            connection.close()

    def set_proxy_mode(self, mode: HuggingFaceProxyMode) -> None:
        now = utc_now_iso()
        with transaction(self._database_path) as connection:
            connection.execute(
                """
                INSERT INTO local_tagger_hf_settings (id, proxy_mode, updated_at)
                VALUES (1, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    proxy_mode = excluded.proxy_mode,
                    updated_at = excluded.updated_at
                """,
                (mode.value, now),
            )

    def create(
        self,
        *,
        task_id: str,
        plan_id: str,
        plan_snapshot_json: str,
        adapter_id: str,
        repo_id: str,
        revision: str,
        model_root: str,
        bytes_total: int,
        files_total: int,
    ):
        now = utc_now_iso()
        try:
            with transaction(self._database_path) as connection:
                connection.execute(
                    """
                    INSERT INTO local_tagger_downloads (
                        id, plan_id, plan_snapshot_json, adapter_id, repo_id,
                        revision, model_root, status, bytes_total, bytes_downloaded,
                        files_total, files_completed, stop_requested, created_at, updated_at
                    ) VALUES (
                        ?, ?, ?, ?, ?, ?, ?, 'queued', ?, 0, ?, 0, 0, ?, ?
                    )
                    """,
                    (
                        task_id,
                        plan_id,
                        plan_snapshot_json,
                        adapter_id,
                        repo_id,
                        revision,
                        model_root,
                        bytes_total,
                        files_total,
                        now,
                        now,
                    ),
                )
                return connection.execute(
                    "SELECT * FROM local_tagger_downloads WHERE id = ?",
                    (task_id,),
                ).fetchone()
        except sqlite3.IntegrityError as error:
            active = self.active_for_plan(plan_id)
            if active is not None:
                return active
            raise ValueError("无法创建打标器下载任务，请刷新状态后重试。") from error

    def list(self, *, limit: int = 50):
        connection = connect(self._database_path)
        try:
            return connection.execute(
                """
                SELECT * FROM local_tagger_downloads
                ORDER BY created_at DESC, rowid DESC
                LIMIT ?
                """,
                (limit,),
            ).fetchall()
        finally:
            connection.close()

    def get(self, task_id: str):
        connection = connect(self._database_path)
        try:
            return connection.execute(
                "SELECT * FROM local_tagger_downloads WHERE id = ?",
                (task_id,),
            ).fetchone()
        finally:
            connection.close()

    def active_for_plan(self, plan_id: str):
        connection = connect(self._database_path)
        try:
            placeholders = ", ".join("?" for _ in _ACTIVE_VALUES)
            return connection.execute(
                f"""
                SELECT * FROM local_tagger_downloads
                WHERE plan_id = ? AND status IN ({placeholders})
                ORDER BY created_at DESC, rowid DESC
                LIMIT 1
                """,
                (plan_id, *_ACTIVE_VALUES),
            ).fetchone()
        finally:
            connection.close()

    def resumable_for_plan(self, plan_id: str):
        connection = connect(self._database_path)
        try:
            placeholders = ", ".join("?" for _ in _RESUMABLE_VALUES)
            return connection.execute(
                f"""
                SELECT * FROM local_tagger_downloads
                WHERE plan_id = ? AND status IN ({placeholders})
                ORDER BY created_at DESC, rowid DESC
                LIMIT 1
                """,
                (plan_id, *_RESUMABLE_VALUES),
            ).fetchone()
        finally:
            connection.close()

    def claim_next(self, worker_id: str):
        now = utc_now_iso()
        with transaction(self._database_path) as connection:
            row = connection.execute(
                """
                SELECT * FROM local_tagger_downloads
                WHERE status = 'queued'
                  AND stop_requested = 0
                  AND NOT EXISTS (
                      SELECT 1
                      FROM local_tagger_downloads AS active
                      WHERE active.status IN (
                          'resolving', 'downloading', 'verifying', 'installing'
                      )
                  )
                ORDER BY created_at, rowid
                LIMIT 1
                """
            ).fetchone()
            if row is None:
                return None
            changed = connection.execute(
                """
                UPDATE local_tagger_downloads
                SET status = 'resolving',
                    worker_id = ?,
                    started_at = COALESCE(started_at, ?),
                    updated_at = ?,
                    error_code = NULL,
                    error_message = NULL,
                    speed_bps = NULL
                WHERE id = ? AND status = 'queued' AND stop_requested = 0
                """,
                (worker_id, now, now, str(row["id"])),
            ).rowcount
            if not changed:
                return None
            return connection.execute(
                "SELECT * FROM local_tagger_downloads WHERE id = ?",
                (str(row["id"]),),
            ).fetchone()

    def set_phase(
        self,
        task_id: str,
        status: TaggerDownloadStatus,
        *,
        current_file: str | None = None,
    ) -> None:
        if status not in ACTIVE_DOWNLOAD_STATUSES:
            raise ValueError(f"下载任务阶段无效：{status.value}")
        with transaction(self._database_path) as connection:
            connection.execute(
                """
                UPDATE local_tagger_downloads
                SET status = ?, current_file = ?, updated_at = ?
                WHERE id = ?
                """,
                (status.value, current_file, utc_now_iso(), task_id),
            )

    def update_progress(
        self,
        task_id: str,
        *,
        bytes_downloaded: int,
        files_completed: int,
        current_file: str | None,
        speed_bps: float | None,
    ) -> None:
        with transaction(self._database_path) as connection:
            connection.execute(
                """
                UPDATE local_tagger_downloads
                SET bytes_downloaded = MIN(bytes_total, ?),
                    files_completed = MIN(files_total, ?),
                    current_file = ?,
                    speed_bps = ?,
                    updated_at = ?
                WHERE id = ?
                """,
                (
                    max(0, bytes_downloaded),
                    max(0, files_completed),
                    current_file,
                    speed_bps,
                    utc_now_iso(),
                    task_id,
                ),
            )

    def is_stop_requested(self, task_id: str) -> bool:
        connection = connect(self._database_path)
        try:
            row = connection.execute(
                "SELECT stop_requested FROM local_tagger_downloads WHERE id = ?",
                (task_id,),
            ).fetchone()
            return bool(row and row["stop_requested"])
        finally:
            connection.close()

    def active_count(self) -> int:
        connection = connect(self._database_path)
        try:
            placeholders = ", ".join("?" for _ in _ACTIVE_VALUES)
            row = connection.execute(
                f"""
                SELECT COUNT(*) AS count
                FROM local_tagger_downloads
                WHERE status IN ({placeholders})
                  AND stop_requested = 0
                """,
                _ACTIVE_VALUES,
            ).fetchone()
            return int(row["count"])
        finally:
            connection.close()

    def request_pause_all(self) -> int:
        now = utc_now_iso()
        with transaction(self._database_path) as connection:
            queued = connection.execute(
                """
                UPDATE local_tagger_downloads
                SET status = 'paused',
                    stop_requested = 0,
                    speed_bps = NULL,
                    updated_at = ?
                WHERE status = 'queued'
                """,
                (now,),
            ).rowcount
            running = connection.execute(
                """
                UPDATE local_tagger_downloads
                SET stop_requested = 1, updated_at = ?
                WHERE status IN ('resolving', 'downloading', 'verifying', 'installing')
                  AND stop_requested = 0
                """,
                (now,),
            ).rowcount
            return queued + running

    def request_pause(self, task_id: str):
        now = utc_now_iso()
        with transaction(self._database_path) as connection:
            row = connection.execute(
                "SELECT * FROM local_tagger_downloads WHERE id = ?",
                (task_id,),
            ).fetchone()
            if row is None:
                return None
            status = TaggerDownloadStatus(str(row["status"]))
            if status == TaggerDownloadStatus.QUEUED:
                connection.execute(
                    """
                    UPDATE local_tagger_downloads
                    SET status = 'paused', stop_requested = 0,
                        speed_bps = NULL, updated_at = ?
                    WHERE id = ?
                    """,
                    (now, task_id),
                )
            elif status in ACTIVE_DOWNLOAD_STATUSES:
                connection.execute(
                    """
                    UPDATE local_tagger_downloads
                    SET stop_requested = 1, updated_at = ?
                    WHERE id = ?
                    """,
                    (now, task_id),
                )
            else:
                raise ValueError("当前下载任务不能暂停。")
            return connection.execute(
                "SELECT * FROM local_tagger_downloads WHERE id = ?",
                (task_id,),
            ).fetchone()

    def resume(self, task_id: str):
        now = utc_now_iso()
        with transaction(self._database_path) as connection:
            row = connection.execute(
                "SELECT * FROM local_tagger_downloads WHERE id = ?",
                (task_id,),
            ).fetchone()
            if row is None:
                return None
            status = TaggerDownloadStatus(str(row["status"]))
            if status not in RESUMABLE_DOWNLOAD_STATUSES:
                raise ValueError("当前下载任务不能继续。")
            connection.execute(
                """
                UPDATE local_tagger_downloads
                SET status = 'queued',
                    stop_requested = 0,
                    worker_id = NULL,
                    current_file = NULL,
                    speed_bps = NULL,
                    error_code = NULL,
                    error_message = NULL,
                    completed_at = NULL,
                    updated_at = ?
                WHERE id = ?
                """,
                (now, task_id),
            )
            return connection.execute(
                "SELECT * FROM local_tagger_downloads WHERE id = ?",
                (task_id,),
            ).fetchone()

    def mark_paused(self, task_id: str) -> None:
        self._mark_incomplete(task_id, TaggerDownloadStatus.PAUSED)

    def mark_interrupted(self, task_id: str) -> None:
        self._mark_incomplete(
            task_id,
            TaggerDownloadStatus.INTERRUPTED,
            error_code="interrupted",
            error_message="应用或后台服务已停止，可继续下载。",
        )

    def fail(self, task_id: str, *, code: str, message: str) -> None:
        self._mark_incomplete(
            task_id,
            TaggerDownloadStatus.FAILED,
            error_code=code,
            error_message=message,
        )

    def _mark_incomplete(
        self,
        task_id: str,
        status: TaggerDownloadStatus,
        *,
        error_code: str | None = None,
        error_message: str | None = None,
    ) -> None:
        with transaction(self._database_path) as connection:
            connection.execute(
                """
                UPDATE local_tagger_downloads
                SET status = ?,
                    stop_requested = 0,
                    worker_id = NULL,
                    speed_bps = NULL,
                    error_code = ?,
                    error_message = ?,
                    updated_at = ?
                WHERE id = ?
                """,
                (status.value, error_code, error_message, utc_now_iso(), task_id),
            )

    def complete(self, task_id: str, installation_id: str) -> None:
        now = utc_now_iso()
        with transaction(self._database_path) as connection:
            connection.execute(
                """
                UPDATE local_tagger_downloads
                SET status = 'completed',
                    bytes_downloaded = bytes_total,
                    files_completed = files_total,
                    current_file = NULL,
                    speed_bps = NULL,
                    stop_requested = 0,
                    worker_id = NULL,
                    installation_id = ?,
                    error_code = NULL,
                    error_message = NULL,
                    completed_at = ?,
                    updated_at = ?
                WHERE id = ?
                """,
                (installation_id, now, now, task_id),
            )

    def recover_orphaned(self) -> int:
        now = utc_now_iso()
        with transaction(self._database_path) as connection:
            return connection.execute(
                """
                UPDATE local_tagger_downloads
                SET status = 'interrupted',
                    stop_requested = 0,
                    worker_id = NULL,
                    speed_bps = NULL,
                    error_code = 'interrupted',
                    error_message = '后台服务上次运行时中断，可继续下载。',
                    updated_at = ?
                WHERE status IN ('resolving', 'downloading', 'verifying', 'installing')
                """,
                (now,),
            ).rowcount

    def delete(self, task_id: str):
        with transaction(self._database_path) as connection:
            row = connection.execute(
                "SELECT * FROM local_tagger_downloads WHERE id = ?",
                (task_id,),
            ).fetchone()
            if row is None:
                return None
            if TaggerDownloadStatus(str(row["status"])) in ACTIVE_DOWNLOAD_STATUSES:
                raise ValueError("运行中的下载任务不能清理。")
            connection.execute("DELETE FROM local_tagger_downloads WHERE id = ?", (task_id,))
            return row

    def has_blocking_tasks(self) -> bool:
        connection = connect(self._database_path)
        try:
            row = connection.execute(
                """
                SELECT 1 FROM local_tagger_downloads
                WHERE status != 'completed'
                LIMIT 1
                """
            ).fetchone()
            return row is not None
        finally:
            connection.close()
