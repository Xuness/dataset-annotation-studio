from __future__ import annotations

import json
from pathlib import Path

from dataset_studio.core.sqlite import connect, transaction
from dataset_studio.core.time import utc_now_iso
from dataset_studio.modules.preprocessing.models import PreprocessOperation, PreprocessRequest


class PreprocessRepository:
    def __init__(self, database_path: Path) -> None:
        self._database_path = database_path

    def start(self, operation_id: str, request: PreprocessRequest) -> None:
        with transaction(self._database_path) as connection:
            connection.execute(
                """
                INSERT INTO preprocess_operations (
                    id, status, options_json, item_count, created_at
                ) VALUES (?, 'running', ?, 0, ?)
                """,
                (operation_id, request.model_dump_json(), utc_now_iso()),
            )

    def add_item(self, operation_id: str, values: tuple[object, ...]) -> None:
        with transaction(self._database_path) as connection:
            connection.execute(
                """
                INSERT INTO preprocess_items (
                    id, operation_id, asset_id, before_relative_path,
                    after_relative_path, before_hash, after_hash,
                    before_width, before_height, after_width, after_height,
                    recovery_relative_path, phase
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                values,
            )
            connection.execute(
                """
                UPDATE preprocess_operations
                SET item_count = item_count + 1
                WHERE id = ?
                """,
                (operation_id,),
            )

    def set_item_phase(self, item_id: str, phase: str) -> None:
        with transaction(self._database_path) as connection:
            cursor = connection.execute(
                "UPDATE preprocess_items SET phase = ? WHERE id = ?",
                (phase, item_id),
            )
            if cursor.rowcount != 1:
                raise RuntimeError(f"预处理恢复日志条目丢失：{item_id}")

    def claim_orphaned(self) -> list[str]:
        with transaction(self._database_path) as connection:
            rows = connection.execute(
                """
                SELECT id FROM preprocess_operations
                WHERE status IN ('running', 'recovering')
                ORDER BY created_at
                """
            ).fetchall()
            operation_ids = [str(row["id"]) for row in rows]
            if operation_ids:
                connection.executemany(
                    """
                    UPDATE preprocess_operations
                    SET status = 'recovering', error_message = ?
                    WHERE id = ?
                    """,
                    [
                        ("检测到上次运行中断，正在自动恢复原文件。", operation_id)
                        for operation_id in operation_ids
                    ],
                )
            return operation_ids

    def complete(self, operation_id: str) -> None:
        with transaction(self._database_path) as connection:
            connection.execute(
                """
                UPDATE preprocess_operations
                SET status = 'completed', completed_at = ?
                WHERE id = ?
                """,
                (utc_now_iso(), operation_id),
            )

    def fail(self, operation_id: str, message: str) -> None:
        with transaction(self._database_path) as connection:
            connection.execute(
                """
                UPDATE preprocess_operations
                SET status = 'failed', error_message = ?, completed_at = ?
                WHERE id = ?
                """,
                (message, utc_now_iso(), operation_id),
            )

    def mark_undone(self, operation_id: str) -> None:
        with transaction(self._database_path) as connection:
            connection.execute(
                """
                UPDATE preprocess_operations
                SET status = 'undone', undone_at = ?
                WHERE id = ?
                """,
                (utc_now_iso(), operation_id),
            )

    def list(self) -> list[PreprocessOperation]:
        connection = connect(self._database_path)
        try:
            rows = connection.execute(
                "SELECT * FROM preprocess_operations ORDER BY created_at DESC"
            ).fetchall()
            return [self._operation(row) for row in rows]
        finally:
            connection.close()

    def get(self, operation_id: str) -> PreprocessOperation | None:
        connection = connect(self._database_path)
        try:
            row = connection.execute(
                "SELECT * FROM preprocess_operations WHERE id = ?", (operation_id,)
            ).fetchone()
            return self._operation(row) if row else None
        finally:
            connection.close()

    def items(self, operation_id: str):
        connection = connect(self._database_path)
        try:
            return connection.execute(
                "SELECT * FROM preprocess_items WHERE operation_id = ? ORDER BY rowid DESC",
                (operation_id,),
            ).fetchall()
        finally:
            connection.close()

    def latest_completed_id(self) -> str | None:
        connection = connect(self._database_path)
        try:
            row = connection.execute(
                """
                SELECT id FROM preprocess_operations
                WHERE status = 'completed'
                ORDER BY created_at DESC
                LIMIT 1
                """
            ).fetchone()
            return str(row["id"]) if row else None
        finally:
            connection.close()

    @staticmethod
    def _operation(row) -> PreprocessOperation:
        return PreprocessOperation(
            id=str(row["id"]),
            status=str(row["status"]),
            item_count=int(row["item_count"]),
            options=PreprocessRequest.model_validate(json.loads(str(row["options_json"]))),
            created_at=str(row["created_at"]),
            completed_at=str(row["completed_at"]) if row["completed_at"] else None,
            undone_at=str(row["undone_at"]) if row["undone_at"] else None,
            error_message=str(row["error_message"]) if row["error_message"] else None,
        )
