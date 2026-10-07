from __future__ import annotations

from pathlib import Path

from dataset_studio.core.migrations import migrate_database
from dataset_studio.core.paths import filesystem_path_key
from dataset_studio.core.sqlite import transaction
from dataset_studio.core.time import utc_now_iso
from dataset_studio.platform.global_migrations import GLOBAL_MIGRATIONS


def initialize_global_database(
    database_path: Path,
    *,
    case_sensitive_paths: bool | None = None,
) -> None:
    migrate_database(database_path, GLOBAL_MIGRATIONS)
    _refresh_recent_workspace_path_keys(
        database_path,
        case_sensitive_paths=case_sensitive_paths,
    )


def _refresh_recent_workspace_path_keys(
    database_path: Path,
    *,
    case_sensitive_paths: bool | None,
) -> None:
    hidden_at = utc_now_iso()
    with transaction(database_path) as connection:
        # The path identity policy can change when an app-data directory is
        # moved between operating systems. Rebuild the partial index only
        # after every row has been normalized and duplicate visible roots
        # have been hidden under the current platform policy.
        connection.execute("DROP INDEX IF EXISTS idx_recent_workspaces_visible_root")
        rows = connection.execute(
            """
            SELECT rowid, project_id, root_path, hidden_at
            FROM recent_workspaces
            ORDER BY
                CASE WHEN hidden_at IS NULL THEN 0 ELSE 1 END,
                last_opened_at DESC,
                rowid DESC
            """
        ).fetchall()
        visible_keys: set[str] = set()
        for row in rows:
            key = filesystem_path_key(
                Path(str(row["root_path"])),
                case_sensitive=case_sensitive_paths,
            )
            connection.execute(
                """
                UPDATE recent_workspaces
                SET root_path_key = ?
                WHERE project_id = ?
                """,
                (key, str(row["project_id"])),
            )
            if row["hidden_at"] is not None:
                continue
            if key not in visible_keys:
                visible_keys.add(key)
                continue
            connection.execute(
                """
                UPDATE recent_workspaces
                SET hidden_at = ?
                WHERE project_id = ?
                """,
                (hidden_at, str(row["project_id"])),
            )
            connection.execute(
                "DELETE FROM worker_workspace_activity WHERE project_id = ?",
                (str(row["project_id"]),),
            )
        connection.execute(
            """
            CREATE UNIQUE INDEX IF NOT EXISTS idx_recent_workspaces_visible_root
            ON recent_workspaces(root_path_key)
            WHERE hidden_at IS NULL
            """
        )
