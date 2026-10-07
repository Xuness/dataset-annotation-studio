"""SQLite audit persistence with optimistic concurrency at every transition."""

from __future__ import annotations

import sqlite3
from contextlib import closing
from pathlib import Path

from dataset_studio.core.errors import ResourceConflictError, StudioError
from dataset_studio.core.sqlite import connect, transaction
from dataset_studio.core.time import utc_now_iso
from dataset_studio.modules.character_audits.models import AuditOperation, AuditSummary


class AuditNotFoundError(StudioError):
    """The requested audit is not present in this workspace."""


def read_operation(connection: sqlite3.Connection, operation_id: str) -> AuditOperation:
    row = connection.execute(
        "SELECT state_json FROM character_audits WHERE id = ?", (operation_id,)
    ).fetchone()
    if row is None:
        raise AuditNotFoundError(f"找不到角色审查任务：{operation_id}")
    return AuditOperation.model_validate_json(str(row["state_json"]))


def get_operation(database: Path, operation_id: str) -> AuditOperation:
    with closing(connect(database)) as connection:
        return read_operation(connection, operation_id)


def insert_operation(database: Path, operation: AuditOperation) -> None:
    with transaction(database) as connection:
        connection.execute(
            "INSERT INTO character_audits VALUES (?, ?, ?, ?, ?, ?)",
            (
                operation.id,
                operation.status,
                operation.version,
                operation.created_at,
                operation.updated_at,
                operation.model_dump_json(),
            ),
        )


def write_operation(connection: sqlite3.Connection, operation: AuditOperation) -> AuditOperation:
    updated = operation.model_copy(
        update={"version": operation.version + 1, "updated_at": utc_now_iso()}
    )
    changed = connection.execute(
        "UPDATE character_audits SET status = ?, version = ?, updated_at = ?, state_json = ? "
        "WHERE id = ? AND version = ?",
        (
            updated.status,
            updated.version,
            updated.updated_at,
            updated.model_dump_json(),
            operation.id,
            operation.version,
        ),
    ).rowcount
    if not changed:
        raise ResourceConflictError("审查任务已被另一个操作更新，请刷新后重试。")
    return updated


def save_operation(database: Path, operation: AuditOperation) -> AuditOperation:
    with transaction(database) as connection:
        return write_operation(connection, operation)


def list_operations(database: Path) -> list[AuditSummary]:
    with closing(connect(database)) as connection:
        rows = connection.execute(
            "SELECT state_json FROM character_audits ORDER BY created_at DESC LIMIT 200"
        ).fetchall()
    operations = [AuditOperation.model_validate_json(str(row["state_json"])) for row in rows]
    return [
        AuditSummary(
            id=op.id,
            status=op.status,
            version=op.version,
            triggers=[p.trigger for p in op.request.profiles],
            created_at=op.created_at,
            updated_at=op.updated_at,
            error=op.error,
        )
        for op in operations
    ]


def claim_operation(database: Path) -> AuditOperation | None:
    with transaction(database) as connection:
        row = connection.execute(
            "SELECT id FROM character_audits WHERE status IN ('queued', 'preparing') "
            "ORDER BY updated_at, created_at LIMIT 1"
        ).fetchone()
        if row is None:
            return None
        operation = read_operation(connection, str(row["id"]))
        return write_operation(
            connection, operation.model_copy(update={"status": "running", "error": None})
        )


def check_version(operation: AuditOperation, version: int) -> None:
    if operation.version != version:
        raise ResourceConflictError("审查版本已变化，请刷新后重试；未覆盖已有人工决定。")


def recover_operations(database: Path) -> None:
    with transaction(database) as connection:
        rows = connection.execute(
            "SELECT id FROM character_audits WHERE status IN ('running', 'stopping')"
        ).fetchall()
        for row in rows:
            op = read_operation(connection, str(row["id"]))
            attempts = [
                item.model_copy(
                    update={
                        "status": "interrupted",
                        "finished_at": utc_now_iso(),
                        "error": "Worker 在调用结束前退出，远端可能已产生费用。",
                    }
                )
                if item.status == "running"
                else item
                for item in op.attempts
            ]
            write_operation(
                connection,
                op.model_copy(
                    update={
                        "status": "interrupted",
                        "attempts": attempts,
                        "error": "审查执行被中断，可从已保存阶段恢复。",
                    }
                ),
            )
