from __future__ import annotations

from pathlib import Path

from dataset_studio.core.sqlite import connect, transaction
from dataset_studio.core.time import utc_now_iso
from dataset_studio.modules.jobs.models import JobItemStatus, JobStatus


class JobLifecycleRepository:
    """User lifecycle commands and whole-job state transitions."""

    def __init__(self, database_path: Path) -> None:
        self._database_path = database_path

    def request_stop(self, job_id: str) -> bool:
        with transaction(self._database_path) as connection:
            cursor = connection.execute(
                """
                UPDATE jobs
                SET stop_requested = 1, status = ?, updated_at = ?
                WHERE id = ? AND status IN ('queued', 'running', 'interrupted')
                """,
                (JobStatus.STOPPING.value, utc_now_iso(), job_id),
            )
            return cursor.rowcount > 0

    def request_stop_all(self) -> int:
        with transaction(self._database_path) as connection:
            cursor = connection.execute(
                """
                UPDATE jobs
                SET stop_requested = 1, status = ?, updated_at = ?
                WHERE status IN ('queued', 'running', 'interrupted')
                """,
                (JobStatus.STOPPING.value, utc_now_iso()),
            )
            return cursor.rowcount

    def active_count(self) -> int:
        connection = connect(self._database_path)
        try:
            return int(
                connection.execute(
                    """
                    SELECT COUNT(*) FROM jobs
                    WHERE status IN ('queued', 'running', 'stopping')
                    """
                ).fetchone()[0]
            )
        finally:
            connection.close()

    def resume(self, job_id: str, *, failed_only: bool = False) -> bool:
        now = utc_now_iso()
        with transaction(self._database_path) as connection:
            job = connection.execute(
                "SELECT id, status FROM jobs WHERE id = ?", (job_id,)
            ).fetchone()
            if job is None:
                return False
            if failed_only:
                if str(job["status"]) != JobStatus.COMPLETED_WITH_ERRORS.value:
                    return False
                cursor = connection.execute(
                    """
                    UPDATE job_items
                    SET status = 'pending', attempt_count = 0, last_error = NULL,
                        validation_status = NULL, updated_at = ?
                    WHERE job_id = ? AND status = 'failed'
                    """,
                    (now, job_id),
                )
                if cursor.rowcount == 0:
                    return False
            else:
                if str(job["status"]) not in {
                    JobStatus.STOPPED.value,
                    JobStatus.INTERRUPTED.value,
                }:
                    return False
                connection.execute(
                    """
                    UPDATE job_items
                    SET status = 'pending', updated_at = ?
                    WHERE job_id = ? AND status IN ('interrupted', 'running')
                    """,
                    (now, job_id),
                )
            connection.execute(
                """
                UPDATE jobs
                SET status = 'queued', stop_requested = 0, completed_at = NULL, updated_at = ?
                WHERE id = ?
                """,
                (now, job_id),
            )
            return True

    def recover_orphaned(self) -> int:
        now = utc_now_iso()
        with transaction(self._database_path) as connection:
            running_jobs = connection.execute(
                "SELECT id FROM jobs WHERE status IN ('running', 'stopping')"
            ).fetchall()
            for job in running_jobs:
                connection.execute(
                    """
                    UPDATE job_attempts
                    SET status = 'interrupted',
                        error_message = COALESCE(
                            error_message,
                            '应用在请求完成前退出，已中断本次尝试。'
                        ),
                        finished_at = ?
                    WHERE status = 'running'
                      AND job_item_id IN (
                          SELECT id FROM job_items
                          WHERE job_id = ? AND status = 'running'
                      )
                    """,
                    (now, job["id"]),
                )
                connection.execute(
                    """
                    UPDATE job_items SET status = 'interrupted', updated_at = ?
                    WHERE job_id = ? AND status = 'running'
                    """,
                    (now, job["id"]),
                )
                connection.execute(
                    """
                    UPDATE jobs
                    SET status = 'interrupted', stop_requested = 0, updated_at = ?
                    WHERE id = ?
                    """,
                    (now, job["id"]),
                )
            return len(running_jobs)

    def finalize_jobs(self) -> None:
        with transaction(self._database_path) as connection:
            jobs = connection.execute(
                """
                SELECT id, status, stop_requested
                FROM jobs
                WHERE status IN ('queued', 'running', 'stopping')
                """
            ).fetchall()
            now = utc_now_iso()
            for job in jobs:
                counts = self._item_counts(connection, str(job["id"]))
                if counts.get(JobItemStatus.RUNNING.value, 0):
                    continue
                if bool(job["stop_requested"]):
                    connection.execute(
                        "UPDATE jobs SET status = ?, updated_at = ? WHERE id = ?",
                        (JobStatus.STOPPED.value, now, job["id"]),
                    )
                    continue
                if counts.get(JobItemStatus.PENDING.value, 0):
                    continue
                failed = counts.get(JobItemStatus.FAILED.value, 0)
                status = (
                    JobStatus.COMPLETED_WITH_ERRORS.value if failed else JobStatus.COMPLETED.value
                )
                connection.execute(
                    """
                    UPDATE jobs SET status = ?, updated_at = ?, completed_at = ? WHERE id = ?
                    """,
                    (status, now, now, job["id"]),
                )

    def finalize_job(self, job_id: str) -> None:
        """Recalculate a terminal job after a manual item transition."""

        with transaction(self._database_path) as connection:
            job = connection.execute(
                "SELECT id, status, stop_requested FROM jobs WHERE id = ?",
                (job_id,),
            ).fetchone()
            if job is None or bool(job["stop_requested"]):
                return
            counts = self._item_counts(connection, job_id)
            if counts.get(JobItemStatus.RUNNING.value, 0) or counts.get(
                JobItemStatus.PENDING.value, 0
            ):
                return
            failed = counts.get(JobItemStatus.FAILED.value, 0)
            status = JobStatus.COMPLETED_WITH_ERRORS.value if failed else JobStatus.COMPLETED.value
            now = utc_now_iso()
            connection.execute(
                """
                UPDATE jobs SET status = ?, updated_at = ?, completed_at = ? WHERE id = ?
                """,
                (status, now, now, job_id),
            )

    @staticmethod
    def _item_counts(connection, job_id: str) -> dict[str, int]:
        return {
            str(row["status"]): int(row["count"])
            for row in connection.execute(
                """
                SELECT status, COUNT(*) AS count
                FROM job_items
                WHERE job_id = ?
                GROUP BY status
                """,
                (job_id,),
            )
        }
