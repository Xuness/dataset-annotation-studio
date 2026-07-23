from __future__ import annotations

import sqlite3
import uuid
from dataclasses import dataclass
from pathlib import Path

from dataset_studio.core.sqlite import connect, transaction
from dataset_studio.core.time import utc_now_iso
from dataset_studio.modules.assets.companions import AssetBundleFileKind
from dataset_studio.modules.assets.deletions.models import (
    AssetDeleteOperation,
    AssetDeleteStatus,
)
from dataset_studio.modules.assets.deletions.planner import AssetDeletionPlan


@dataclass(frozen=True, slots=True)
class DeleteFileRecord:
    id: str
    position: int
    kind: AssetBundleFileKind
    source_relative_path: str
    recovery_relative_path: str
    content_hash: str
    byte_size: int
    modified_ns: int
    phase: str


class AssetDeletionRepository:
    def __init__(self, database_path: Path) -> None:
        self._database_path = database_path

    def start(
        self,
        operation_id: str,
        plan: AssetDeletionPlan,
        recovery_paths: list[str],
    ) -> AssetDeleteOperation:
        if len(recovery_paths) != len(plan.files):
            raise ValueError("素材删除恢复清单与文件计划不一致。")
        now = utc_now_iso()
        with transaction(self._database_path) as connection:
            connection.execute(
                """
                INSERT INTO asset_delete_operations (
                    id, status, asset_count, file_count,
                    image_count, annotation_count, translation_count, metadata_count,
                    shared_sidecar_count, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    operation_id,
                    AssetDeleteStatus.RUNNING.value,
                    len(plan.assets),
                    len(plan.files),
                    plan.count(AssetBundleFileKind.IMAGE),
                    plan.count(AssetBundleFileKind.ANNOTATION),
                    plan.count(AssetBundleFileKind.TRANSLATION),
                    plan.count(AssetBundleFileKind.METADATA),
                    plan.shared_sidecar_count,
                    now,
                    now,
                ),
            )
            for position, asset in enumerate(plan.assets):
                connection.execute(
                    """
                    INSERT INTO asset_delete_items (
                        id, operation_id, position, asset_id, relative_path, content_hash
                    ) VALUES (?, ?, ?, ?, ?, ?)
                    """,
                    (
                        str(uuid.uuid4()),
                        operation_id,
                        position,
                        asset.asset_id,
                        asset.relative_path,
                        asset.content_hash,
                    ),
                )
            for position, (file, recovery_path) in enumerate(
                zip(plan.files, recovery_paths, strict=True)
            ):
                connection.execute(
                    """
                    INSERT INTO asset_delete_files (
                        id, operation_id, position, kind,
                        source_relative_path, recovery_relative_path,
                        content_hash, byte_size, modified_ns, phase
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'planned')
                    """,
                    (
                        str(uuid.uuid4()),
                        operation_id,
                        position,
                        file.kind.value,
                        file.source_relative_path,
                        recovery_path,
                        file.content_hash,
                        file.byte_size,
                        file.modified_ns,
                    ),
                )
        operation = self.get(operation_id)
        if operation is None:
            raise RuntimeError("创建素材删除记录失败。")
        return operation

    def get(self, operation_id: str) -> AssetDeleteOperation | None:
        connection = connect(self._database_path)
        try:
            row = connection.execute(
                "SELECT * FROM asset_delete_operations WHERE id = ?",
                (operation_id,),
            ).fetchone()
        finally:
            connection.close()
        return self._operation(row) if row else None

    def list_operations(self, limit: int = 50) -> list[AssetDeleteOperation]:
        connection = connect(self._database_path)
        try:
            rows = connection.execute(
                """
                SELECT *
                FROM asset_delete_operations
                ORDER BY created_at DESC, rowid DESC
                LIMIT ?
                """,
                (min(max(limit, 1), 200),),
            ).fetchall()
        finally:
            connection.close()
        return [self._operation(row) for row in rows]

    def files(self, operation_id: str) -> list[DeleteFileRecord]:
        connection = connect(self._database_path)
        try:
            rows = connection.execute(
                """
                SELECT *
                FROM asset_delete_files
                WHERE operation_id = ?
                ORDER BY position
                """,
                (operation_id,),
            ).fetchall()
        finally:
            connection.close()
        return [
            DeleteFileRecord(
                id=str(row["id"]),
                position=int(row["position"]),
                kind=AssetBundleFileKind(str(row["kind"])),
                source_relative_path=str(row["source_relative_path"]),
                recovery_relative_path=str(row["recovery_relative_path"]),
                content_hash=str(row["content_hash"]),
                byte_size=int(row["byte_size"]),
                modified_ns=int(row["modified_ns"]),
                phase=str(row["phase"]),
            )
            for row in rows
        ]

    def asset_ids(self, operation_id: str) -> list[str]:
        connection = connect(self._database_path)
        try:
            rows = connection.execute(
                """
                SELECT asset_id
                FROM asset_delete_items
                WHERE operation_id = ?
                ORDER BY position
                """,
                (operation_id,),
            ).fetchall()
        finally:
            connection.close()
        return [str(row["asset_id"]) for row in rows]

    def asset_presence(self, operation_id: str) -> tuple[int, int]:
        connection = connect(self._database_path)
        try:
            row = connection.execute(
                """
                SELECT
                    COUNT(*) AS total,
                    SUM(CASE WHEN assets.is_present = 1 THEN 1 ELSE 0 END) AS present
                FROM asset_delete_items
                JOIN assets ON assets.id = asset_delete_items.asset_id
                WHERE asset_delete_items.operation_id = ?
                """,
                (operation_id,),
            ).fetchone()
        finally:
            connection.close()
        return int(row["present"] or 0), int(row["total"] or 0)

    def set_file_phase(self, file_id: str, phase: str) -> None:
        with transaction(self._database_path) as connection:
            connection.execute(
                "UPDATE asset_delete_files SET phase = ? WHERE id = ?",
                (phase, file_id),
            )

    def complete(self, operation_id: str) -> None:
        now = utc_now_iso()
        with transaction(self._database_path) as connection:
            connection.execute(
                """
                UPDATE assets
                SET is_present = 0, updated_at = ?
                WHERE id IN (
                    SELECT asset_id FROM asset_delete_items WHERE operation_id = ?
                )
                """,
                (now, operation_id),
            )
            updated = connection.execute(
                """
                UPDATE asset_delete_operations
                SET status = ?, updated_at = ?, completed_at = ?, error_message = NULL
                WHERE id = ? AND status = ?
                """,
                (
                    AssetDeleteStatus.COMPLETED.value,
                    now,
                    now,
                    operation_id,
                    AssetDeleteStatus.RUNNING.value,
                ),
            )
            if updated.rowcount != 1:
                raise ValueError("素材删除状态已发生变化。")

    def begin_undo(self, operation_id: str) -> None:
        now = utc_now_iso()
        with transaction(self._database_path) as connection:
            updated = connection.execute(
                """
                UPDATE asset_delete_operations
                SET status = ?, updated_at = ?, error_message = NULL
                WHERE id = ? AND status = ?
                """,
                (
                    AssetDeleteStatus.UNDOING.value,
                    now,
                    operation_id,
                    AssetDeleteStatus.COMPLETED.value,
                ),
            )
            if updated.rowcount != 1:
                raise ValueError("只有已完成且尚未撤销的素材删除可以恢复。")

    def complete_undo(self, operation_id: str) -> None:
        now = utc_now_iso()
        with transaction(self._database_path) as connection:
            connection.execute(
                """
                UPDATE assets
                SET is_present = 1, updated_at = ?
                WHERE id IN (
                    SELECT asset_id FROM asset_delete_items WHERE operation_id = ?
                )
                """,
                (now, operation_id),
            )
            updated = connection.execute(
                """
                UPDATE asset_delete_operations
                SET status = ?, updated_at = ?, undone_at = ?, error_message = NULL
                WHERE id = ? AND status IN (?, ?)
                """,
                (
                    AssetDeleteStatus.UNDONE.value,
                    now,
                    now,
                    operation_id,
                    AssetDeleteStatus.UNDOING.value,
                    AssetDeleteStatus.RECOVERING.value,
                ),
            )
            if updated.rowcount != 1:
                raise ValueError("素材删除撤销状态已发生变化。")

    def reset_completed(self, operation_id: str, message: str) -> None:
        self._set_status(operation_id, AssetDeleteStatus.COMPLETED, message)

    def mark_failed(self, operation_id: str, message: str) -> None:
        self._set_status(operation_id, AssetDeleteStatus.FAILED, message)

    def mark_recovery_required(self, operation_id: str, message: str) -> None:
        self._set_status(operation_id, AssetDeleteStatus.RECOVERY_REQUIRED, message)

    def mark_recovering(self, operation_id: str) -> None:
        self._set_status(operation_id, AssetDeleteStatus.RECOVERING, "正在恢复中断的素材删除。")

    def active_operations(self) -> list[AssetDeleteOperation]:
        return self._operations_by_status(("running", "undoing", "recovering", "recovery_required"))

    def in_progress_operations(self) -> list[AssetDeleteOperation]:
        return self._operations_by_status(("running", "undoing", "recovering"))

    def _operations_by_status(self, statuses: tuple[str, ...]) -> list[AssetDeleteOperation]:
        placeholders = ", ".join("?" for _ in statuses)
        connection = connect(self._database_path)
        try:
            rows = connection.execute(
                f"""
                SELECT *
                FROM asset_delete_operations
                WHERE status IN ({placeholders})
                ORDER BY created_at
                """,
                statuses,
            ).fetchall()
        finally:
            connection.close()
        return [self._operation(row) for row in rows]

    def _set_status(
        self,
        operation_id: str,
        status: AssetDeleteStatus,
        message: str,
    ) -> None:
        with transaction(self._database_path) as connection:
            connection.execute(
                """
                UPDATE asset_delete_operations
                SET status = ?, updated_at = ?, error_message = ?
                WHERE id = ?
                """,
                (status.value, utc_now_iso(), message, operation_id),
            )

    @staticmethod
    def _operation(row: sqlite3.Row) -> AssetDeleteOperation:
        return AssetDeleteOperation.model_validate(dict(row))
