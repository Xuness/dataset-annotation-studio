from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Literal

from dataset_studio.core.paths import filesystem_path_key
from dataset_studio.core.sqlite import connect, transaction
from dataset_studio.core.time import utc_now_iso
from dataset_studio.modules.workspaces.models import WorkspaceManifest

WorkerActivityKind = Literal["jobs", "exports"]
_ACTIVITY_COLUMNS: dict[WorkerActivityKind, str] = {
    "jobs": "jobs_requested_at",
    "exports": "exports_requested_at",
}


@dataclass(frozen=True, slots=True)
class WorkerWorkspaceCandidate:
    project_id: str
    requested_at: str


class WorkspaceRegistry:
    def __init__(
        self,
        database_path: Path,
        *,
        case_sensitive_paths: bool | None = None,
    ) -> None:
        self._database_path = database_path
        self._case_sensitive_paths = case_sensitive_paths

    def upsert(self, manifest: WorkspaceManifest, root_path: Path, opened_at: str) -> None:
        root = str(root_path)
        root_key = filesystem_path_key(
            root_path,
            case_sensitive=self._case_sensitive_paths,
        )
        with transaction(self._database_path) as connection:
            connection.execute(
                """
                UPDATE recent_workspaces
                SET hidden_at = ?
                WHERE project_id != ?
                  AND hidden_at IS NULL
                  AND root_path_key = ?
                """,
                (opened_at, manifest.project_id, root_key),
            )
            connection.execute(
                """
                INSERT INTO recent_workspaces (
                    project_id, name, root_path, root_path_key,
                    created_at, last_opened_at, hidden_at
                ) VALUES (?, ?, ?, ?, ?, ?, NULL)
                ON CONFLICT(project_id) DO UPDATE SET
                    name = excluded.name,
                    root_path = excluded.root_path,
                    root_path_key = excluded.root_path_key,
                    last_opened_at = excluded.last_opened_at,
                    hidden_at = NULL
                """,
                (
                    manifest.project_id,
                    manifest.name,
                    root,
                    root_key,
                    manifest.created_at,
                    opened_at,
                ),
            )

    def resolve_path(self, project_id: str) -> Path | None:
        connection = connect(self._database_path)
        try:
            row = connection.execute(
                "SELECT root_path FROM recent_workspaces WHERE project_id = ?", (project_id,)
            ).fetchone()
            return Path(str(row["root_path"])) if row else None
        finally:
            connection.close()

    def list_rows(self):
        connection = connect(self._database_path)
        try:
            return connection.execute(
                """
                SELECT *
                FROM recent_workspaces
                WHERE hidden_at IS NULL
                ORDER BY last_opened_at DESC
                """
            ).fetchall()
        finally:
            connection.close()

    def list_recent_project_ids(self) -> list[str]:
        connection = connect(self._database_path)
        try:
            return [
                str(row["project_id"])
                for row in connection.execute(
                    """
                    SELECT project_id
                    FROM recent_workspaces
                    WHERE hidden_at IS NULL
                    ORDER BY last_opened_at DESC
                    """
                ).fetchall()
            ]
        finally:
            connection.close()

    def recent_path(self, project_id: str) -> Path | None:
        connection = connect(self._database_path)
        try:
            row = connection.execute(
                """
                SELECT root_path
                FROM recent_workspaces
                WHERE project_id = ? AND hidden_at IS NULL
                """,
                (project_id,),
            ).fetchone()
            return Path(str(row["root_path"])) if row else None
        finally:
            connection.close()

    def hide_recent(self, project_id: str) -> bool:
        hidden_at = utc_now_iso()
        with transaction(self._database_path) as connection:
            changed = connection.execute(
                """
                UPDATE recent_workspaces
                SET hidden_at = ?
                WHERE project_id = ? AND hidden_at IS NULL
                """,
                (hidden_at, project_id),
            ).rowcount
            if not changed:
                return False
            connection.execute(
                "DELETE FROM worker_workspace_activity WHERE project_id = ?",
                (project_id,),
            )
            return True

    def mark_worker_activity(
        self,
        project_id: str,
        kind: WorkerActivityKind,
    ) -> None:
        column = _ACTIVITY_COLUMNS[kind]
        requested_at = utc_now_iso()
        with transaction(self._database_path) as connection:
            connection.execute(
                f"""
                INSERT INTO worker_workspace_activity (project_id, {column})
                VALUES (?, ?)
                ON CONFLICT(project_id) DO UPDATE SET
                    {column} = excluded.{column}
                """,
                (project_id, requested_at),
            )

    def list_worker_candidates(
        self,
        kind: WorkerActivityKind,
    ) -> list[WorkerWorkspaceCandidate]:
        column = _ACTIVITY_COLUMNS[kind]
        connection = connect(self._database_path)
        try:
            return [
                WorkerWorkspaceCandidate(
                    project_id=str(row["project_id"]),
                    requested_at=str(row["requested_at"]),
                )
                for row in connection.execute(
                    f"""
                    SELECT project_id, {column} AS requested_at
                    FROM worker_workspace_activity
                    WHERE {column} IS NOT NULL
                    ORDER BY {column}, project_id
                    """
                ).fetchall()
            ]
        finally:
            connection.close()

    def clear_worker_activity(
        self,
        project_id: str,
        kind: WorkerActivityKind,
        *,
        requested_at: str | None = None,
    ) -> bool:
        column = _ACTIVITY_COLUMNS[kind]
        other_column = _ACTIVITY_COLUMNS["exports" if kind == "jobs" else "jobs"]
        with transaction(self._database_path) as connection:
            if requested_at is None:
                parameters = (project_id,)
                condition = f"project_id = ? AND {column} IS NOT NULL"
            else:
                parameters = (project_id, requested_at)
                condition = f"project_id = ? AND {column} = ?"
            row = connection.execute(
                f"""
                SELECT {other_column}
                FROM worker_workspace_activity
                WHERE {condition}
                """,
                parameters,
            ).fetchone()
            if row is None:
                return False
            if row[other_column] is None:
                changed = connection.execute(
                    f"""
                    DELETE FROM worker_workspace_activity
                    WHERE {condition}
                    """,
                    parameters,
                ).rowcount
            else:
                changed = connection.execute(
                    f"""
                    UPDATE worker_workspace_activity
                    SET {column} = NULL
                    WHERE {condition}
                    """,
                    parameters,
                ).rowcount
            return bool(changed)
