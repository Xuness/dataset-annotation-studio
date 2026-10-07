import sqlite3
from pathlib import Path

import pytest

from dataset_studio.core.migrations import migrate_database
from dataset_studio.core.paths import filesystem_path_key
from dataset_studio.core.sqlite import connect
from dataset_studio.core.time import utc_now_iso
from dataset_studio.modules.workspaces.models import WorkspaceManifest
from dataset_studio.modules.workspaces.repository import WorkspaceRegistry
from dataset_studio.modules.workspaces.schema import (
    WORKSPACE_MIGRATIONS,
    initialize_workspace_database,
)
from dataset_studio.platform.global_store import GLOBAL_MIGRATIONS, initialize_global_database


def test_local_dictionary_job_migration_preserves_jobs_and_expands_backend(
    tmp_path: Path,
) -> None:
    database = tmp_path / "workspace.sqlite3"
    migrate_database(database, WORKSPACE_MIGRATIONS[:16])
    connection = connect(database)
    try:
        connection.execute(
            """
            INSERT INTO jobs (
                id, status,
                system_preset_id, system_prompt_snapshot,
                provider_profile_id, provider_snapshot,
                user_prompt_snapshot, json_fields_snapshot,
                scope, created_at, updated_at,
                kind, configuration_snapshot,
                execution_backend, execution_profile_id, execution_snapshot,
                output_channel, use_tags_as_context
            ) VALUES (
                'legacy-job', 'completed',
                'preset', '{}',
                'provider', '{}',
                '', '[]',
                'all', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z',
                'annotation', '{}',
                'provider', 'provider', '{}',
                'description', 0
            )
            """
        )
        connection.commit()
    finally:
        connection.close()

    initialize_workspace_database(database)

    connection = connect(database)
    try:
        legacy = connection.execute(
            "SELECT execution_backend, status FROM jobs WHERE id = 'legacy-job'"
        ).fetchone()
        connection.execute(
            """
            INSERT INTO jobs (
                id, status,
                system_preset_id, system_prompt_snapshot,
                provider_profile_id, provider_snapshot,
                user_prompt_snapshot, json_fields_snapshot,
                scope, created_at, updated_at,
                kind, configuration_snapshot,
                execution_backend, execution_profile_id, execution_snapshot,
                output_channel, use_tags_as_context
            ) VALUES (
                'dictionary-job', 'queued',
                '', '{}',
                '', '{}',
                '', '[]',
                'all', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z',
                'translation', '{}',
                'local_dictionary', 'local_dictionary', '{}',
                'translation', 0
            )
            """
        )
        connection.commit()
    finally:
        connection.close()

    assert dict(legacy) == {
        "execution_backend": "provider",
        "status": "completed",
    }


def test_recent_workspace_activity_migration_hides_duplicate_roots(
    tmp_path: Path,
) -> None:
    database = tmp_path / "global.sqlite3"
    migrate_database(database, GLOBAL_MIGRATIONS[:7])
    connection = connect(database)
    try:
        connection.executemany(
            """
            INSERT INTO recent_workspaces (
                project_id, name, root_path, created_at, last_opened_at
            ) VALUES (?, ?, ?, ?, ?)
            """,
            [
                (
                    "older",
                    "Older",
                    r"E:\Dataset",
                    "2026-01-01T00:00:00Z",
                    "2026-01-02T00:00:00Z",
                ),
                (
                    "newer",
                    "Newer",
                    r"e:\dataset",
                    "2026-01-01T00:00:00Z",
                    "2026-01-03T00:00:00Z",
                ),
            ],
        )
        connection.commit()
    finally:
        connection.close()

    initialize_global_database(database, case_sensitive_paths=False)

    connection = connect(database)
    try:
        rows = connection.execute(
            """
            SELECT project_id, hidden_at
            FROM recent_workspaces
            ORDER BY project_id
            """
        ).fetchall()
        activity_columns = {
            row["name"]
            for row in connection.execute(
                "PRAGMA table_info('worker_workspace_activity')"
            ).fetchall()
        }
        activity_projects = [
            str(row["project_id"])
            for row in connection.execute(
                "SELECT project_id FROM worker_workspace_activity ORDER BY project_id"
            ).fetchall()
        ]
        with pytest.raises(sqlite3.IntegrityError):
            connection.execute(
                """
                INSERT INTO recent_workspaces (
                    project_id, name, root_path, root_path_key,
                    created_at, last_opened_at, hidden_at
                ) VALUES (
                    'duplicate', 'Duplicate', 'E:\\DATASET', ?,
                    '2026-01-01T00:00:00Z', '2026-01-04T00:00:00Z', NULL
                )
                """,
                (filesystem_path_key(Path(r"E:\DATASET"), case_sensitive=False),),
            )
    finally:
        connection.close()

    by_project = {str(row["project_id"]): row["hidden_at"] for row in rows}
    assert by_project["older"] is not None
    assert by_project["newer"] is None
    assert activity_columns == {
        "project_id",
        "jobs_requested_at",
        "exports_requested_at",
        "screening_requested_at",
        "character_audits_requested_at",
    }
    assert activity_projects == ["newer"]


def test_screening_worker_activity_migration_preserves_existing_activity(
    tmp_path: Path,
) -> None:
    database = tmp_path / "global.sqlite3"
    migrate_database(database, GLOBAL_MIGRATIONS[:15])
    connection = connect(database)
    try:
        connection.execute(
            """
            INSERT INTO recent_workspaces (
                project_id, name, root_path, root_path_key, created_at, last_opened_at
            ) VALUES ('project', 'Dataset', 'E:/dataset', ?, ?, ?)
            """,
            (
                filesystem_path_key(Path("E:/dataset"), case_sensitive=False),
                utc_now_iso(),
                utc_now_iso(),
            ),
        )
        connection.execute(
            """
            INSERT INTO worker_workspace_activity (
                project_id, jobs_requested_at, exports_requested_at
            ) VALUES ('project', ?, NULL)
            """,
            (utc_now_iso(),),
        )
        connection.commit()
    finally:
        connection.close()

    initialize_global_database(database)

    connection = connect(database)
    try:
        row = connection.execute(
            """
            SELECT jobs_requested_at, exports_requested_at, screening_requested_at
            FROM worker_workspace_activity WHERE project_id = 'project'
            """
        ).fetchone()
        foreign_key_violations = connection.execute("PRAGMA foreign_key_check").fetchall()
    finally:
        connection.close()

    assert row["jobs_requested_at"] is not None
    assert row["exports_requested_at"] is None
    assert row["screening_requested_at"] is None
    assert foreign_key_violations == []


def test_recent_workspace_identity_can_preserve_posix_case(tmp_path: Path) -> None:
    database = tmp_path / "global.sqlite3"
    initialize_global_database(database, case_sensitive_paths=True)
    registry = WorkspaceRegistry(database, case_sensitive_paths=True)
    opened_at = "2026-01-01T00:00:00Z"

    registry.upsert(
        WorkspaceManifest(project_id="upper", name="Upper", created_at=opened_at),
        tmp_path / "Dataset",
        opened_at,
    )
    registry.upsert(
        WorkspaceManifest(project_id="lower", name="Lower", created_at=opened_at),
        tmp_path / "dataset",
        opened_at,
    )

    assert set(registry.list_recent_project_ids()) == {"upper", "lower"}


def test_recent_workspace_identity_rebuilds_when_case_policy_changes(
    tmp_path: Path,
) -> None:
    database = tmp_path / "global.sqlite3"
    initialize_global_database(database, case_sensitive_paths=True)
    sensitive_registry = WorkspaceRegistry(database, case_sensitive_paths=True)
    sensitive_registry.upsert(
        WorkspaceManifest(
            project_id="upper",
            name="Upper",
            created_at="2026-01-01T00:00:00Z",
        ),
        tmp_path / "Dataset",
        "2026-01-01T00:00:00Z",
    )
    sensitive_registry.upsert(
        WorkspaceManifest(
            project_id="lower",
            name="Lower",
            created_at="2026-01-02T00:00:00Z",
        ),
        tmp_path / "dataset",
        "2026-01-02T00:00:00Z",
    )

    initialize_global_database(database, case_sensitive_paths=False)
    insensitive_registry = WorkspaceRegistry(database, case_sensitive_paths=False)

    assert insensitive_registry.list_recent_project_ids() == ["lower"]
