import threading
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pytest

from dataset_studio.core.config import Settings
from dataset_studio.core.migrations import migrate_database
from dataset_studio.core.sqlite import connect
from dataset_studio.core.time import utc_now_iso
from dataset_studio.modules.workspaces.models import WorkspaceManifest
from dataset_studio.modules.workspaces.paths import WorkspacePaths
from dataset_studio.modules.workspaces.repository import WorkspaceRegistry
from dataset_studio.modules.workspaces.schema import (
    WORKSPACE_MIGRATIONS,
    initialize_workspace_database,
)
from dataset_studio.modules.workspaces.service import WorkspaceService
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
        translation_prompt = connection.execute(
            """
            SELECT id, name, system_prompt
            FROM translation_prompt_presets
            WHERE id = 'default-translation-prompt'
            """
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
    assert translation_prompt["name"] == "默认结构保留翻译"
    assert "{target_language}" in translation_prompt["system_prompt"]
    assert versions == [1, 2, 3]


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
        attempt_columns = {
            entry["name"]: entry
            for entry in connection.execute("PRAGMA table_info('job_attempts')").fetchall()
        }
    finally:
        connection.close()
    assert row["image_metadata_version"] == 1
    assert versions == [1, 2, 3, 4, 5]
    assert "idx_job_items_asset_updated" in indexes
    assert {
        "cache_read_tokens",
        "cache_write_tokens",
        "reasoning_tokens",
    }.issubset(attempt_columns)
    assert attempt_columns["cache_read_tokens"]["notnull"] == 0
    assert "source_annotation_hash" in attempt_columns


def test_workspace_migration_is_safe_when_api_and_worker_start_together(tmp_path: Path) -> None:
    database = tmp_path / "workspace.sqlite3"
    migrate_database(database, WORKSPACE_MIGRATIONS[:3])
    barrier = threading.Barrier(4)

    def initialize() -> None:
        barrier.wait()
        initialize_workspace_database(database)

    with ThreadPoolExecutor(max_workers=4) as executor:
        futures = [executor.submit(initialize) for _ in range(4)]
        for future in futures:
            future.result()

    connection = connect(database)
    try:
        versions = [
            row["version"]
            for row in connection.execute(
                "SELECT version FROM schema_migrations ORDER BY version"
            ).fetchall()
        ]
    finally:
        connection.close()
    assert versions == [1, 2, 3, 4, 5]


def test_recent_workspace_get_applies_missing_migrations(tmp_path: Path) -> None:
    settings = Settings(app_data_dir=tmp_path / "app-data", host="127.0.0.1", port=0)
    settings.ensure_directories()
    global_database = settings.app_data_dir / "global.sqlite3"
    initialize_global_database(global_database)
    registry = WorkspaceRegistry(global_database)

    root = tmp_path / "dataset"
    root.mkdir()
    paths = WorkspacePaths.from_root(root, settings)
    paths.ensure_directories()
    manifest = WorkspaceManifest(
        project_id="recent-project",
        name="dataset",
        created_at=utc_now_iso(),
    )
    paths.manifest.write_text(manifest.model_dump_json(indent=2), encoding="utf-8")
    migrate_database(paths.database, WORKSPACE_MIGRATIONS[:3])
    registry.upsert(manifest, root, utc_now_iso())

    WorkspaceService(settings, registry).get(manifest.project_id)

    connection = connect(paths.database)
    try:
        versions = [
            row["version"]
            for row in connection.execute(
                "SELECT version FROM schema_migrations ORDER BY version"
            ).fetchall()
        ]
    finally:
        connection.close()
    assert versions == [1, 2, 3, 4, 5]
