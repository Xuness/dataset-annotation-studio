from __future__ import annotations

import hashlib
import sqlite3
from dataclasses import dataclass
from pathlib import Path

from dataset_studio.core.sqlite import connect


@dataclass(frozen=True, slots=True)
class Migration:
    version: int
    name: str
    sql: str
    foreign_keys_off: bool = False

    @property
    def checksum(self) -> str:
        payload = f"foreign_keys_off\n{self.sql}" if self.foreign_keys_off else self.sql
        return hashlib.sha256(payload.encode("utf-8")).hexdigest()


MIGRATION_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    checksum TEXT NOT NULL,
    applied_at TEXT NOT NULL
)
"""


def migrate_database(database_path: Path, migrations: tuple[Migration, ...]) -> None:
    """Apply immutable, ordered SQLite migrations.

    Migration checksums deliberately make editing an already released migration
    fail loudly. Schema changes must be added as a new migration instead.
    """

    _validate_plan(migrations)
    connection = connect(database_path)
    try:
        connection.execute(MIGRATION_TABLE_SQL)
        connection.commit()
        applied = {
            int(row["version"]): (str(row["name"]), str(row["checksum"]))
            for row in connection.execute(
                "SELECT version, name, checksum FROM schema_migrations"
            ).fetchall()
        }
        known_versions = {migration.version for migration in migrations}
        unknown_versions = sorted(set(applied) - known_versions)
        if unknown_versions:
            raise RuntimeError(
                "数据库版本高于当前应用可识别范围："
                + ", ".join(str(version) for version in unknown_versions)
            )

        for migration in migrations:
            recorded = applied.get(migration.version)
            if recorded:
                _verify_recorded_migration(migration, recorded)
                continue
            _apply_migration(connection, migration)
    finally:
        if connection.in_transaction:
            connection.rollback()
        connection.close()


def _validate_plan(migrations: tuple[Migration, ...]) -> None:
    versions = [migration.version for migration in migrations]
    expected = list(range(1, len(migrations) + 1))
    if versions != expected:
        raise ValueError(f"数据库迁移版本必须从 1 连续递增，当前为：{versions}")
    if len({migration.name for migration in migrations}) != len(migrations):
        raise ValueError("数据库迁移名称不能重复。")


def _apply_migration(connection, migration: Migration) -> None:
    foreign_keys_disabled = False
    try:
        if migration.foreign_keys_off:
            if connection.in_transaction:
                raise RuntimeError("关闭 SQLite 外键检查前不应存在活动事务。")
            connection.execute("PRAGMA foreign_keys = OFF")
            foreign_keys_disabled = True
        connection.execute("BEGIN IMMEDIATE")
        recorded_row = connection.execute(
            "SELECT name, checksum FROM schema_migrations WHERE version = ?",
            (migration.version,),
        ).fetchone()
        if recorded_row is not None:
            _verify_recorded_migration(
                migration,
                (str(recorded_row["name"]), str(recorded_row["checksum"])),
            )
            connection.commit()
            return

        _execute_migration_sql(connection, migration.sql)
        if migration.foreign_keys_off:
            violations = connection.execute("PRAGMA foreign_key_check").fetchall()
            if violations:
                first = violations[0]
                raise RuntimeError(
                    "数据库迁移后的外键完整性检查失败："
                    f"{first['table']} rowid={first['rowid']} parent={first['parent']}"
                )
        connection.execute(
            """
            INSERT INTO schema_migrations (version, name, checksum, applied_at)
            VALUES (?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
            """,
            (migration.version, migration.name, migration.checksum),
        )
        connection.commit()
    except BaseException:
        if connection.in_transaction:
            connection.rollback()
        raise
    finally:
        if foreign_keys_disabled:
            connection.execute("PRAGMA foreign_keys = ON")


def _verify_recorded_migration(
    migration: Migration,
    recorded: tuple[str, str],
) -> None:
    if recorded != (migration.name, migration.checksum):
        raise RuntimeError(
            f"数据库迁移 {migration.version} ({migration.name}) 校验失败；请勿修改已发布的迁移。"
        )


def _execute_migration_sql(connection, script: str) -> None:
    """Execute a SQL script without sqlite3.executescript's implicit commit."""

    buffer: list[str] = []
    for character in script:
        buffer.append(character)
        if character != ";":
            continue
        statement = "".join(buffer)
        if not sqlite3.complete_statement(statement):
            continue
        if statement.strip():
            connection.execute(statement)
        buffer.clear()

    remainder = "".join(buffer).strip()
    if remainder:
        raise ValueError("数据库迁移 SQL 的最后一条语句缺少分号。")
