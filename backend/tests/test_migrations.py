from pathlib import Path

import pytest

from dataset_studio.core.migrations import migrate_database
from dataset_studio.core.sqlite import connect
from dataset_studio.modules.workspaces.schema import (
    WORKSPACE_MIGRATIONS,
    initialize_workspace_database,
)
from dataset_studio.platform.global_store import GLOBAL_MIGRATIONS, initialize_global_database


@pytest.mark.parametrize(
    "initializer,filename",
    [
        (initialize_global_database, "global.sqlite3"),
        (initialize_workspace_database, "workspace.sqlite3"),
    ],
)
def test_database_initialization_records_and_verifies_migration(
    tmp_path: Path, initializer, filename: str
) -> None:
    database = tmp_path / filename
    initializer(database)

    connection = connect(database)
    try:
        migration = connection.execute(
            "SELECT version, name, checksum FROM schema_migrations"
        ).fetchone()
        assert migration["version"] == 1
        assert migration["name"].startswith("initial_")
        assert len(migration["checksum"]) == 64
        connection.execute("UPDATE schema_migrations SET checksum = 'tampered'")
        connection.commit()
    finally:
        connection.close()

    with pytest.raises(RuntimeError, match="校验失败"):
        initializer(database)


def test_global_database_migrates_existing_provider_profiles(tmp_path: Path) -> None:
    database = tmp_path / "global.sqlite3"
    migrate_database(database, (GLOBAL_MIGRATIONS[0],))
    connection = connect(database)
    try:
        connection.execute(
            """
            INSERT INTO provider_profiles (
                id, name, provider_type, base_url, model, temperature,
                max_output_tokens, concurrency, timeout_seconds, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                "profile",
                "Legacy OpenRouter",
                "openrouter",
                "https://openrouter.ai/api/v1",
                "example/model",
                0.2,
                4096,
                4,
                180,
                "2026-01-01T00:00:00Z",
                "2026-01-01T00:00:00Z",
            ),
        )
        connection.commit()
    finally:
        connection.close()

    initialize_global_database(database)

    connection = connect(database)
    try:
        row = connection.execute(
            "SELECT request_options_json FROM provider_profiles WHERE id = 'profile'"
        ).fetchone()
        versions = [
            entry["version"]
            for entry in connection.execute(
                "SELECT version FROM schema_migrations ORDER BY version"
            ).fetchall()
        ]
    finally:
        connection.close()
    assert row["request_options_json"] == "{}"
    assert versions == [1, 2]


def test_workspace_database_migrates_existing_asset_metadata_version(tmp_path: Path) -> None:
    database = tmp_path / "workspace.sqlite3"
    migrate_database(database, (WORKSPACE_MIGRATIONS[0],))
    connection = connect(database)
    try:
        connection.execute(
            """
            INSERT INTO assets (
                id, relative_path, filename, stem, suffix, content_hash,
                byte_size, modified_ns, width, height, annotation_relative_path,
                annotation_status, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                "asset",
                "image.png",
                "image.png",
                "image",
                ".png",
                "hash",
                1,
                1,
                120,
                60,
                "image.txt",
                "missing",
                "2026-01-01T00:00:00Z",
                "2026-01-01T00:00:00Z",
            ),
        )
        connection.commit()
    finally:
        connection.close()

    initialize_workspace_database(database)

    connection = connect(database)
    try:
        row = connection.execute(
            "SELECT image_metadata_version FROM assets WHERE id = 'asset'"
        ).fetchone()
        versions = [
            entry["version"]
            for entry in connection.execute(
                "SELECT version FROM schema_migrations ORDER BY version"
            ).fetchall()
        ]
        indexes = {
            entry["name"]
            for entry in connection.execute("PRAGMA index_list('job_items')").fetchall()
        }
    finally:
        connection.close()
    assert row["image_metadata_version"] == 1
    assert versions == [1, 2, 3]
    assert "idx_job_items_asset_updated" in indexes
