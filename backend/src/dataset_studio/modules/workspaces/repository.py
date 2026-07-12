from __future__ import annotations

from pathlib import Path

from dataset_studio.core.sqlite import connect, transaction
from dataset_studio.modules.workspaces.models import WorkspaceManifest


class WorkspaceRegistry:
    def __init__(self, database_path: Path) -> None:
        self._database_path = database_path

    def upsert(self, manifest: WorkspaceManifest, root_path: Path, opened_at: str) -> None:
        with transaction(self._database_path) as connection:
            connection.execute(
                """
                INSERT INTO recent_workspaces (
                    project_id, name, root_path, created_at, last_opened_at
                ) VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(project_id) DO UPDATE SET
                    name = excluded.name,
                    root_path = excluded.root_path,
                    last_opened_at = excluded.last_opened_at
                """,
                (
                    manifest.project_id,
                    manifest.name,
                    str(root_path),
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
                "SELECT * FROM recent_workspaces ORDER BY last_opened_at DESC"
            ).fetchall()
        finally:
            connection.close()
