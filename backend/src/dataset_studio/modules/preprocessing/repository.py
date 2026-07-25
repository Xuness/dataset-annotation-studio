from __future__ import annotations

import json
import math
from datetime import UTC, datetime
from pathlib import Path

from dataset_studio.core.sqlite import connect, transaction
from dataset_studio.core.time import utc_now_iso
from dataset_studio.modules.preprocessing.models import (
    PreprocessExecutionOptions,
    PreprocessExecutionRuntime,
    PreprocessOperation,
    PreprocessRequest,
)


class PreprocessRepository:
    def __init__(self, database_path: Path) -> None:
        self._database_path = database_path

    def start(
        self,
        operation_id: str,
        request: PreprocessRequest,
        execution: PreprocessExecutionOptions,
        item_count: int,
    ) -> None:
        with transaction(self._database_path) as connection:
            connection.execute(
                """
                INSERT INTO preprocess_operations (
                    id, status, options_json, execution_json, item_count, created_at
                ) VALUES (?, 'running', ?, ?, ?, ?)
                """,
                (
                    operation_id,
                    request.model_dump_json(),
                    execution.model_dump_json(),
                    item_count,
                    utc_now_iso(),
                ),
            )

    def add_item(self, operation_id: str, values: tuple[object, ...]) -> None:
        with transaction(self._database_path) as connection:
            connection.execute(
                """
                INSERT INTO preprocess_items (
                    id, operation_id, asset_id, before_relative_path,
                    after_relative_path, before_hash, after_hash,
                    before_width, before_height, after_width, after_height,
                    recovery_relative_path, phase, planned_route, actual_route,
                    backend_id, decode_location, resize_location, encode_location,
                    route_reason_code, fallback_code, render_duration_ms
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                values,
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

    def complete(
        self,
        operation_id: str,
        runtime: PreprocessExecutionRuntime,
    ) -> None:
        with transaction(self._database_path) as connection:
            connection.execute(
                """
                UPDATE preprocess_operations
                SET status = 'completed', completed_at = ?, runtime_json = ?
                WHERE id = ?
                """,
                (utc_now_iso(), runtime.model_dump_json(), operation_id),
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
                f"{self._operation_select()} ORDER BY operation.created_at DESC"
            ).fetchall()
            return [self._operation(row) for row in rows]
        finally:
            connection.close()

    def get(self, operation_id: str) -> PreprocessOperation | None:
        connection = connect(self._database_path)
        try:
            row = connection.execute(
                f"{self._operation_select()} WHERE operation.id = ?",
                (operation_id,),
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
    def _operation_select() -> str:
        return """
            SELECT
                operation.*,
                (
                    SELECT COUNT(*)
                    FROM preprocess_items item
                    WHERE item.operation_id = operation.id
                      AND item.phase = 'committed'
                ) AS completed_items,
                (
                    SELECT item.after_relative_path
                    FROM preprocess_items item
                    WHERE item.operation_id = operation.id
                    ORDER BY item.rowid DESC
                    LIMIT 1
                ) AS current_relative_path
            FROM preprocess_operations operation
        """

    @staticmethod
    def _eta_seconds(
        *,
        status: str,
        created_at: str,
        completed_items: int,
        item_count: int,
    ) -> int | None:
        if status != "running" or completed_items <= 0 or completed_items >= item_count:
            return None
        started_at = datetime.fromisoformat(created_at)
        if started_at.tzinfo is None:
            started_at = started_at.replace(tzinfo=UTC)
        elapsed_seconds = max(0.001, (datetime.now(UTC) - started_at).total_seconds())
        remaining_items = item_count - completed_items
        return max(1, math.ceil(elapsed_seconds * remaining_items / completed_items))

    @staticmethod
    def _operation(row) -> PreprocessOperation:
        status = str(row["status"])
        item_count = int(row["item_count"])
        completed_items = int(row["completed_items"])
        created_at = str(row["created_at"])
        return PreprocessOperation(
            id=str(row["id"]),
            status=status,
            item_count=item_count,
            completed_items=completed_items,
            eta_seconds=PreprocessRepository._eta_seconds(
                status=status,
                created_at=created_at,
                completed_items=completed_items,
                item_count=item_count,
            ),
            current_relative_path=(
                str(row["current_relative_path"]) if row["current_relative_path"] else None
            ),
            options=PreprocessRequest.model_validate(json.loads(str(row["options_json"]))),
            execution=PreprocessExecutionOptions.model_validate(
                json.loads(str(row["execution_json"]))
            ),
            created_at=created_at,
            completed_at=str(row["completed_at"]) if row["completed_at"] else None,
            undone_at=str(row["undone_at"]) if row["undone_at"] else None,
            error_message=str(row["error_message"]) if row["error_message"] else None,
            runtime=(
                PreprocessExecutionRuntime.model_validate(json.loads(str(row["runtime_json"])))
                if row["runtime_json"]
                else None
            ),
        )
