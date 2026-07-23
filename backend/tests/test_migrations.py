import json
import sqlite3
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
        profile = connection.execute(
            """
            SELECT default_model_id, concurrency
            FROM provider_profiles
            WHERE id = 'profile'
            """
        ).fetchone()
        model = connection.execute(
            """
            SELECT model_id, position, temperature, max_output_tokens,
                   timeout_seconds, top_p, seed, protocol_options_json
            FROM provider_model_configs
            WHERE provider_profile_id = 'profile'
            """
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
    assert profile["default_model_id"] == "example/model"
    assert profile["concurrency"] == 4
    assert model["model_id"] == "example/model"
    assert model["position"] == 0
    assert model["temperature"] == 0.2
    assert model["max_output_tokens"] == 4096
    assert model["timeout_seconds"] == 180
    assert model["top_p"] is None
    assert model["seed"] is None
    assert json.loads(model["protocol_options_json"]) == {
        "provider_type": "openrouter",
        "service_tier": None,
        "reasoning_effort": None,
        "prompt_cache_strategy": None,
    }
    assert translation_prompt["name"] == "默认结构保留翻译"
    assert "{target_language}" in translation_prompt["system_prompt"]
    assert versions == [1, 2, 3, 4, 5, 6, 7]


def test_local_tagger_batching_migration_preserves_profiles_and_allows_auto(
    tmp_path: Path,
) -> None:
    database = tmp_path / "global.sqlite3"
    migrate_database(database, GLOBAL_MIGRATIONS[:6])
    connection = connect(database)
    try:
        connection.execute(
            """
            INSERT INTO local_tagger_installations (
                id, name, adapter_id, model_version, relative_path,
                fingerprint, manifest_json, created_at, updated_at
            ) VALUES (
                'installation', 'Model', 'fake', 'v1', 'fake/v1',
                ?, '{}', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'
            )
            """,
            ("a" * 64,),
        )
        connection.execute(
            """
            INSERT INTO local_tagger_profiles (
                id, name, installation_id, threshold, categories_json,
                device, concurrency, created_at, updated_at
            ) VALUES (
                'profile', 'Profile', 'installation', 0.55, '["general"]',
                'auto', 4, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'
            )
            """
        )
        connection.commit()
    finally:
        connection.close()

    initialize_global_database(database)

    connection = connect(database)
    try:
        profile = connection.execute(
            "SELECT concurrency, batch_size FROM local_tagger_profiles WHERE id = 'profile'"
        ).fetchone()
        assert profile["concurrency"] == 4
        assert profile["batch_size"] is None
        connection.execute("UPDATE local_tagger_profiles SET batch_size = 32 WHERE id = 'profile'")
        with pytest.raises(sqlite3.IntegrityError):
            connection.execute(
                "UPDATE local_tagger_profiles SET batch_size = 33 WHERE id = 'profile'"
            )
    finally:
        connection.close()


def test_provider_model_config_migration_copies_shared_options_to_each_model(
    tmp_path: Path,
) -> None:
    database = tmp_path / "global.sqlite3"
    migrate_database(database, GLOBAL_MIGRATIONS[:4])
    connection = connect(database)
    try:
        connection.execute(
            """
            INSERT INTO provider_profiles (
                id, name, provider_type, base_url, model, models_json,
                temperature, max_output_tokens, concurrency, timeout_seconds,
                request_options_json, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                "multi-model-profile",
                "Legacy multi-model provider",
                "openai_compatible",
                "https://example.invalid/v1",
                "model/default",
                json.dumps(["model/default", "model/alternate"]),
                0.65,
                8192,
                3,
                240,
                json.dumps(
                    {
                        "top_p": 0.9,
                        "seed": 7,
                        "reasoning_effort": "high",
                    }
                ),
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
        profile = connection.execute(
            """
            SELECT default_model_id, concurrency
            FROM provider_profiles
            WHERE id = 'multi-model-profile'
            """
        ).fetchone()
        models = connection.execute(
            """
            SELECT model_id, position, temperature, max_output_tokens,
                   timeout_seconds, top_p, seed, protocol_options_json
            FROM provider_model_configs
            WHERE provider_profile_id = 'multi-model-profile'
            ORDER BY position
            """
        ).fetchall()
    finally:
        connection.close()

    assert profile["default_model_id"] == "model/default"
    assert profile["concurrency"] == 3
    assert [row["model_id"] for row in models] == [
        "model/default",
        "model/alternate",
    ]
    for position, model in enumerate(models):
        assert model["position"] == position
        assert model["temperature"] == 0.65
        assert model["max_output_tokens"] == 8192
        assert model["timeout_seconds"] == 240
        assert model["top_p"] == 0.9
        assert model["seed"] == 7
        assert json.loads(model["protocol_options_json"]) == {
            "provider_type": "openai_compatible",
            "reasoning_effort": "high",
        }


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
        preprocess_item_columns = {
            entry["name"]: entry
            for entry in connection.execute("PRAGMA table_info('preprocess_items')").fetchall()
        }
        job_columns = {
            entry["name"]: entry
            for entry in connection.execute("PRAGMA table_info('jobs')").fetchall()
        }
        tables = {
            entry["name"]
            for entry in connection.execute(
                "SELECT name FROM sqlite_master WHERE type = 'table'"
            ).fetchall()
        }
    finally:
        connection.close()
    assert row["image_metadata_version"] == 1
    assert versions == [1, 2, 3, 4, 5, 6, 7, 8, 9]
    assert "idx_job_items_asset_updated" in indexes
    assert {
        "cache_read_tokens",
        "cache_write_tokens",
        "reasoning_tokens",
    }.issubset(attempt_columns)
    assert attempt_columns["cache_read_tokens"]["notnull"] == 0
    assert "source_annotation_hash" in attempt_columns
    assert {
        "export_operations",
        "export_items",
        "asset_delete_operations",
        "asset_delete_items",
        "asset_delete_files",
    }.issubset(tables)
    assert preprocess_item_columns["phase"]["notnull"] == 1
    assert preprocess_item_columns["phase"]["dflt_value"] == "'committed'"
    assert {"execution_backend", "execution_profile_id", "execution_snapshot"}.issubset(job_columns)


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
    assert versions == [1, 2, 3, 4, 5, 6, 7, 8, 9]


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
    assert versions == [1, 2, 3, 4, 5, 6, 7, 8, 9]


def test_recent_workspace_list_applies_missing_migrations_before_summary(
    tmp_path: Path,
) -> None:
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
    migrate_database(paths.database, WORKSPACE_MIGRATIONS[:4])
    registry.upsert(manifest, root, utc_now_iso())

    summaries = WorkspaceService(settings, registry).list_recent()

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
    assert [summary.project_id for summary in summaries] == [manifest.project_id]
    assert versions == [1, 2, 3, 4, 5, 6, 7, 8, 9]
