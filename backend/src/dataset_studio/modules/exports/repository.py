from __future__ import annotations

import json
import uuid
from dataclasses import asdict, dataclass
from pathlib import Path

from dataset_studio.core.sqlite import connect, transaction
from dataset_studio.core.time import utc_now_iso
from dataset_studio.modules.exports.models import (
    ExportOperation,
    ExportOperationStatus,
    ExportRequest,
)
from dataset_studio.modules.exports.planner import ExportPlan

ACTIVE_EXPORT_STATUSES = (
    ExportOperationStatus.QUEUED.value,
    ExportOperationStatus.RUNNING.value,
    ExportOperationStatus.STOPPING.value,
)


@dataclass(frozen=True, slots=True)
class RecoveredExport:
    operation_id: str
    destination_path: str
    target_names: tuple[str, ...]
    packaging: str


class ExportRepository:
    def __init__(self, database_path: Path) -> None:
        self._database_path = database_path

    def create(
        self,
        operation_id: str,
        request: ExportRequest,
        plan: ExportPlan,
        *,
        allow_warnings: bool,
    ) -> None:
        now = utc_now_iso()
        warning_count = sum(item.warning_code is not None for item in plan.items)
        total_bytes = sum(artifact.byte_size for item in plan.items for artifact in item.artifacts)
        configuration_snapshot = json.dumps(
            {
                "channels": [selection.model_dump(mode="json") for selection in request.channels],
                "formats": [format_.value for format_ in request.formats],
                "packaging": request.packaging.value,
            },
            ensure_ascii=False,
            separators=(",", ":"),
        )
        with transaction(self._database_path) as connection:
            active = connection.execute(
                """
                SELECT id FROM export_operations
                WHERE status IN ('queued', 'running', 'stopping')
                LIMIT 1
                """
            ).fetchone()
            if active is not None:
                raise ValueError("当前项目已有导出任务正在进行，请等待或先停止该任务。")
            connection.execute(
                """
                INSERT INTO export_operations (
                    id, status, scope, destination_path, total_items,
                    completed_items, total_bytes, copied_bytes, warning_count,
                    allow_warnings, stop_requested, configuration_snapshot,
                    created_at, updated_at
                ) VALUES (?, 'queued', ?, ?, ?, 0, ?, 0, ?, ?, 0, ?, ?, ?)
                """,
                (
                    operation_id,
                    request.scope.value,
                    plan.destination_path,
                    len(plan.items),
                    total_bytes,
                    warning_count,
                    int(allow_warnings),
                    configuration_snapshot,
                    now,
                    now,
                ),
            )
            for position, item in enumerate(plan.items):
                connection.execute(
                    """
                    INSERT INTO export_items (
                        id, operation_id, position, asset_id,
                        source_relative_path, annotation_relative_path,
                        target_image_name, target_annotation_name,
                        image_hash, image_size, image_modified_ns,
                        annotation_exists, annotation_hash, annotation_size,
                        annotation_modified_ns, annotation_status,
                        warning_code, warning_message, status, copied_bytes,
                        artifact_snapshot, created_at, updated_at
                    ) VALUES (
                        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                        'pending', 0, ?, ?, ?
                    )
                    """,
                    (
                        str(uuid.uuid4()),
                        operation_id,
                        position,
                        item.asset_id,
                        item.source_relative_path,
                        item.annotation_relative_path,
                        item.target_image_name,
                        item.target_annotation_name,
                        item.image_hash,
                        item.image_size,
                        item.image_modified_ns,
                        int(item.annotation_exists),
                        item.annotation_hash,
                        item.annotation_size,
                        item.annotation_modified_ns,
                        item.annotation_status,
                        item.warning_code,
                        item.warning_message,
                        json.dumps(
                            [asdict(artifact) for artifact in item.artifacts],
                            ensure_ascii=False,
                            separators=(",", ":"),
                        ),
                        now,
                        now,
                    ),
                )

    def list(self, *, limit: int = 100) -> list[ExportOperation]:
        connection = connect(self._database_path)
        try:
            rows = connection.execute(
                """
                SELECT * FROM export_operations
                ORDER BY created_at DESC, rowid DESC
                LIMIT ?
                """,
                (limit,),
            ).fetchall()
            return [self._operation(row) for row in rows]
        finally:
            connection.close()

    def get(self, operation_id: str) -> ExportOperation | None:
        connection = connect(self._database_path)
        try:
            row = connection.execute(
                "SELECT * FROM export_operations WHERE id = ?",
                (operation_id,),
            ).fetchone()
            return self._operation(row) if row else None
        finally:
            connection.close()

    def operation_items(self, operation_id: str):
        connection = connect(self._database_path)
        try:
            return connection.execute(
                """
                SELECT * FROM export_items
                WHERE operation_id = ?
                ORDER BY position
                """,
                (operation_id,),
            ).fetchall()
        finally:
            connection.close()

    def claim_next_operation(self) -> ExportOperation | None:
        now = utc_now_iso()
        with transaction(self._database_path) as connection:
            row = connection.execute(
                """
                SELECT * FROM export_operations
                WHERE status = 'queued' AND stop_requested = 0
                ORDER BY created_at, rowid
                LIMIT 1
                """
            ).fetchone()
            if row is None:
                return None
            changed = connection.execute(
                """
                UPDATE export_operations
                SET status = 'running',
                    started_at = COALESCE(started_at, ?),
                    updated_at = ?,
                    error_message = NULL
                WHERE id = ? AND status = 'queued' AND stop_requested = 0
                """,
                (now, now, str(row["id"])),
            ).rowcount
            if not changed:
                return None
            claimed = connection.execute(
                "SELECT * FROM export_operations WHERE id = ?",
                (str(row["id"]),),
            ).fetchone()
            return self._operation(claimed)

    def claim_next_item(self, operation_id: str):
        now = utc_now_iso()
        with transaction(self._database_path) as connection:
            row = connection.execute(
                """
                SELECT * FROM export_items
                WHERE operation_id = ? AND status = 'pending'
                ORDER BY position
                LIMIT 1
                """,
                (operation_id,),
            ).fetchone()
            if row is None:
                return None
            changed = connection.execute(
                """
                UPDATE export_items
                SET status = 'running', updated_at = ?, error_message = NULL
                WHERE id = ? AND status = 'pending'
                """,
                (now, str(row["id"])),
            ).rowcount
            if not changed:
                return None
            connection.execute(
                """
                UPDATE export_operations
                SET current_relative_path = ?, updated_at = ?
                WHERE id = ?
                """,
                (str(row["source_relative_path"]), now, operation_id),
            )
            return connection.execute(
                "SELECT * FROM export_items WHERE id = ?",
                (str(row["id"]),),
            ).fetchone()

    def complete_item(self, operation_id: str, item_id: str, copied_bytes: int) -> None:
        now = utc_now_iso()
        with transaction(self._database_path) as connection:
            changed = connection.execute(
                """
                UPDATE export_items
                SET status = 'completed', copied_bytes = ?, updated_at = ?
                WHERE id = ? AND operation_id = ? AND status = 'running'
                """,
                (copied_bytes, now, item_id, operation_id),
            ).rowcount
            if not changed:
                raise RuntimeError("导出条目状态已经变化，无法记录完成状态。")
            connection.execute(
                """
                UPDATE export_operations
                SET completed_items = completed_items + 1,
                    copied_bytes = copied_bytes + ?,
                    current_relative_path = NULL,
                    updated_at = ?
                WHERE id = ?
                """,
                (copied_bytes, now, operation_id),
            )

    def reset_running_item(self, operation_id: str) -> None:
        now = utc_now_iso()
        with transaction(self._database_path) as connection:
            connection.execute(
                """
                UPDATE export_items
                SET status = 'pending', copied_bytes = 0,
                    error_message = NULL, updated_at = ?
                WHERE operation_id = ? AND status = 'running'
                """,
                (now, operation_id),
            )
            connection.execute(
                """
                UPDATE export_operations
                SET current_relative_path = NULL, updated_at = ?
                WHERE id = ?
                """,
                (now, operation_id),
            )

    def reset_archive_progress(self, operation_id: str) -> None:
        now = utc_now_iso()
        with transaction(self._database_path) as connection:
            connection.execute(
                """
                UPDATE export_items
                SET status = 'pending', copied_bytes = 0,
                    error_message = NULL, updated_at = ?
                WHERE operation_id = ?
                """,
                (now, operation_id),
            )
            connection.execute(
                """
                UPDATE export_operations
                SET completed_items = 0, copied_bytes = 0,
                    current_relative_path = NULL, updated_at = ?
                WHERE id = ?
                """,
                (now, operation_id),
            )

    def fail(
        self,
        operation_id: str,
        message: str,
        *,
        item_id: str | None = None,
    ) -> None:
        now = utc_now_iso()
        with transaction(self._database_path) as connection:
            if item_id:
                connection.execute(
                    """
                    UPDATE export_items
                    SET status = 'failed', error_message = ?, updated_at = ?
                    WHERE id = ? AND operation_id = ?
                    """,
                    (message, now, item_id, operation_id),
                )
            connection.execute(
                """
                UPDATE export_operations
                SET status = 'failed', error_message = ?,
                    current_relative_path = NULL, completed_at = ?, updated_at = ?
                WHERE id = ?
                """,
                (message, now, now, operation_id),
            )

    def complete(self, operation_id: str) -> None:
        now = utc_now_iso()
        with transaction(self._database_path) as connection:
            remaining = int(
                connection.execute(
                    """
                    SELECT COUNT(*) FROM export_items
                    WHERE operation_id = ? AND status != 'completed'
                    """,
                    (operation_id,),
                ).fetchone()[0]
            )
            if remaining:
                raise RuntimeError(f"仍有 {remaining} 个导出条目未完成。")
            connection.execute(
                """
                UPDATE export_operations
                SET status = 'completed', completed_items = total_items,
                    copied_bytes = total_bytes, current_relative_path = NULL,
                    completed_at = ?, updated_at = ?
                WHERE id = ?
                """,
                (now, now, operation_id),
            )

    def request_stop(self, operation_id: str) -> bool:
        now = utc_now_iso()
        with transaction(self._database_path) as connection:
            row = connection.execute(
                "SELECT status FROM export_operations WHERE id = ?",
                (operation_id,),
            ).fetchone()
            if row is None or str(row["status"]) not in ACTIVE_EXPORT_STATUSES:
                return False
            if str(row["status"]) == ExportOperationStatus.QUEUED.value:
                connection.execute(
                    """
                    UPDATE export_operations
                    SET status = 'stopped', stop_requested = 1,
                        completed_at = ?, updated_at = ?
                    WHERE id = ?
                    """,
                    (now, now, operation_id),
                )
            else:
                connection.execute(
                    """
                    UPDATE export_operations
                    SET status = 'stopping', stop_requested = 1, updated_at = ?
                    WHERE id = ?
                    """,
                    (now, operation_id),
                )
            return True

    def request_stop_all(self) -> int:
        now = utc_now_iso()
        with transaction(self._database_path) as connection:
            queued = connection.execute(
                """
                UPDATE export_operations
                SET status = 'stopped', stop_requested = 1,
                    completed_at = ?, updated_at = ?
                WHERE status = 'queued'
                """,
                (now, now),
            ).rowcount
            running = connection.execute(
                """
                UPDATE export_operations
                SET status = 'stopping', stop_requested = 1, updated_at = ?
                WHERE status IN ('running', 'stopping')
                """,
                (now,),
            ).rowcount
            return queued + running

    def is_stop_requested(self, operation_id: str) -> bool:
        connection = connect(self._database_path)
        try:
            row = connection.execute(
                """
                SELECT stop_requested, status
                FROM export_operations
                WHERE id = ?
                """,
                (operation_id,),
            ).fetchone()
            return bool(
                row
                and (
                    int(row["stop_requested"])
                    or str(row["status"]) == ExportOperationStatus.STOPPING.value
                )
            )
        finally:
            connection.close()

    def mark_stopped(self, operation_id: str) -> None:
        self._mark_inactive(operation_id, ExportOperationStatus.STOPPED)

    def mark_interrupted(self, operation_id: str) -> None:
        self._mark_inactive(operation_id, ExportOperationStatus.INTERRUPTED)

    def _mark_inactive(
        self,
        operation_id: str,
        status: ExportOperationStatus,
    ) -> None:
        now = utc_now_iso()
        with transaction(self._database_path) as connection:
            connection.execute(
                """
                UPDATE export_items
                SET status = 'pending', copied_bytes = 0,
                    error_message = NULL, updated_at = ?
                WHERE operation_id = ? AND status = 'running'
                """,
                (now, operation_id),
            )
            connection.execute(
                """
                UPDATE export_operations
                SET status = ?, current_relative_path = NULL,
                    completed_at = ?, updated_at = ?
                WHERE id = ?
                """,
                (status.value, now, now, operation_id),
            )

    def resume(self, operation_id: str) -> bool:
        now = utc_now_iso()
        with transaction(self._database_path) as connection:
            active = int(
                connection.execute(
                    """
                    SELECT COUNT(*) FROM export_operations
                    WHERE status IN ('queued', 'running', 'stopping')
                    """
                ).fetchone()[0]
            )
            if active:
                raise ValueError("当前项目已有导出任务正在进行。")
            changed = connection.execute(
                """
                UPDATE export_operations
                SET status = 'queued', stop_requested = 0,
                    completed_at = NULL, error_message = NULL,
                    current_relative_path = NULL, updated_at = ?
                WHERE id = ? AND status IN ('stopped', 'interrupted')
                """,
                (now, operation_id),
            ).rowcount
            return bool(changed)

    def recover_orphaned(self) -> list[RecoveredExport]:
        now = utc_now_iso()
        with transaction(self._database_path) as connection:
            rows = connection.execute(
                """
                SELECT o.id AS operation_id, o.destination_path,
                       o.configuration_snapshot,
                       i.target_image_name, i.target_annotation_name,
                       i.annotation_exists, i.artifact_snapshot
                FROM export_operations o
                LEFT JOIN export_items i
                  ON i.operation_id = o.id AND i.status = 'running'
                WHERE o.status IN ('running', 'stopping')
                ORDER BY o.created_at, i.position
                """
            ).fetchall()
            recovered: dict[str, tuple[str, list[str], str]] = {}
            for row in rows:
                operation_id = str(row["operation_id"])
                try:
                    configuration = json.loads(str(row["configuration_snapshot"]))
                except (json.JSONDecodeError, TypeError):
                    configuration = {}
                packaging = (
                    str(configuration.get("packaging", "directory"))
                    if isinstance(configuration, dict)
                    else "directory"
                )
                destination_path, names, packaging = recovered.setdefault(
                    operation_id,
                    (str(row["destination_path"]), [], packaging),
                )
                if packaging != "zip":
                    try:
                        artifacts = json.loads(str(row["artifact_snapshot"]))
                    except (json.JSONDecodeError, TypeError):
                        artifacts = []
                    if artifacts:
                        names.extend(
                            str(artifact["target_relative_path"])
                            for artifact in artifacts
                            if isinstance(artifact, dict) and artifact.get("target_relative_path")
                        )
                    else:
                        if row["target_image_name"]:
                            names.append(str(row["target_image_name"]))
                        if row["target_annotation_name"] and int(row["annotation_exists"] or 0):
                            names.append(str(row["target_annotation_name"]))
                recovered[operation_id] = (destination_path, names, packaging)
            if not recovered:
                return []
            connection.execute(
                """
                UPDATE export_items
                SET status = 'pending', copied_bytes = 0,
                    error_message = NULL, updated_at = ?
                WHERE status = 'running'
                  AND operation_id IN (
                      SELECT id FROM export_operations
                      WHERE status IN ('running', 'stopping')
                  )
                """,
                (now,),
            )
            for operation_id, (_destination_path, _names, packaging) in recovered.items():
                if packaging != "zip":
                    continue
                connection.execute(
                    """
                    UPDATE export_items
                    SET status = 'pending', copied_bytes = 0,
                        error_message = NULL, updated_at = ?
                    WHERE operation_id = ?
                    """,
                    (now, operation_id),
                )
                connection.execute(
                    """
                    UPDATE export_operations
                    SET completed_items = 0, copied_bytes = 0
                    WHERE id = ?
                    """,
                    (operation_id,),
                )
            connection.execute(
                """
                UPDATE export_operations
                SET status = 'interrupted', stop_requested = 0,
                    current_relative_path = NULL, completed_at = ?, updated_at = ?
                WHERE status IN ('running', 'stopping')
                """,
                (now, now),
            )
            return [
                RecoveredExport(operation_id, destination_path, tuple(names), packaging)
                for operation_id, (destination_path, names, packaging) in recovered.items()
            ]

    def active_count(self) -> int:
        connection = connect(self._database_path)
        try:
            placeholders = ",".join("?" for _ in ACTIVE_EXPORT_STATUSES)
            return int(
                connection.execute(
                    f"""
                    SELECT COUNT(*) FROM export_operations
                    WHERE status IN ({placeholders})
                    """,
                    ACTIVE_EXPORT_STATUSES,
                ).fetchone()[0]
            )
        finally:
            connection.close()

    @staticmethod
    def _operation(row) -> ExportOperation:
        try:
            configuration = json.loads(str(row["configuration_snapshot"]))
        except (json.JSONDecodeError, TypeError):
            configuration = {}
        return ExportOperation(
            id=str(row["id"]),
            status=ExportOperationStatus(str(row["status"])),
            scope=str(row["scope"]),
            destination_path=str(row["destination_path"]),
            total_items=int(row["total_items"]),
            completed_items=int(row["completed_items"]),
            total_bytes=int(row["total_bytes"]),
            copied_bytes=int(row["copied_bytes"]),
            warning_count=int(row["warning_count"]),
            allow_warnings=bool(row["allow_warnings"]),
            configuration_snapshot=configuration if isinstance(configuration, dict) else {},
            current_relative_path=(
                str(row["current_relative_path"])
                if row["current_relative_path"] is not None
                else None
            ),
            created_at=str(row["created_at"]),
            updated_at=str(row["updated_at"]),
            started_at=str(row["started_at"]) if row["started_at"] else None,
            completed_at=str(row["completed_at"]) if row["completed_at"] else None,
            error_message=str(row["error_message"]) if row["error_message"] else None,
        )
