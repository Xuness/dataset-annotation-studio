import importlib
import json
import pkgutil
import sqlite3
import threading
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pytest

from dataset_studio.core.config import Settings
from dataset_studio.core.migrations import Migration, migrate_database
from dataset_studio.core.paths import filesystem_path_key
from dataset_studio.core.sqlite import connect
from dataset_studio.core.time import utc_now_iso
from dataset_studio.modules.annotations.models import AnnotationChannel, AnnotationStatus
from dataset_studio.modules.annotations.repository import AnnotationRepository
from dataset_studio.modules.workspaces.models import WorkspaceManifest
from dataset_studio.modules.workspaces.paths import WorkspacePaths
from dataset_studio.modules.workspaces.repository import WorkspaceRegistry
from dataset_studio.modules.workspaces.schema import (
    WORKSPACE_MIGRATIONS,
    WORKSPACE_SCHEMA_VERSION,
    initialize_workspace_database,
)
from dataset_studio.modules.workspaces.service import WorkspaceService
from dataset_studio.platform.global_store import GLOBAL_MIGRATIONS, initialize_global_database

EXPECTED_WORKSPACE_MIGRATION_CHECKSUMS = {
    1: "a7b50fece8e0aafa67b4c59636d4a616653ffb268a7e106b3ef3f39317609f60",
    2: "f9851a12e095767fa170c29f645f501051eb2c92cc065b916c1690ff3792ed6f",
    3: "050898ead57c796933f3663c7e4553fc03adcd8c05e74d4cb824a0a0aa0dad10",
    4: "fbd250cb4b4670a84fb9d71df3e876fa885402fcbd17a547d46079f373d393fa",
    5: "509fec77efed4abd2f929d27bd1ab3672e274da3263d558fe9471c9a30d7f5b1",
    6: "cef4042886ce8ecfb473b2c585139b957ffb830ea10e084a16873a6a89006b8c",
    7: "39800739573fe7cb2932f0ed85e6bb282f472ca5e481b5e8e1cc2d36a2239e53",
    8: "25e84380d067373e6fa1139613f0698b6985e24ccb09a98b0c4a1a10a3b650e9",
    9: "a3b1a418ea8ac88e5e5b4180e5da4bf4c4bdabbd28babb90d38cfbade1533210",
    10: "4e6862b1690e872d82f085ee4c58f7db337fbdd25abaf8034e70e234471fb1d0",
    11: "cc0040fe94536e7453ce876af0cf75d53441829154fcf5f5fd5e7315b5b37685",
    12: "313ef7efbc403b4bd46ac7cc65e77e32f2f178a053f866b1104560eab1e2c0fb",
    13: "05ae357184022303f22dcd49d4c53460844bfcc7ba9b05b37e0bbd75f00ad59c",
    14: "ec00973ffc0b07c4a531fe343cd88ab98b29b1511267bac0facca10edb4fe78e",
    15: "75e040ea6904594889def8a785ceecd13a6b4e5cddd17b234e96ee9dd70afdd5",
    16: "9b7e99492fe535f035db23760d3903be63c374abb5f21c3161412542b59fa12b",
    17: "ed30a1d11d3d3cf01a49aee9ee739778d20db94e956f7117190272c2e6c1d6c2",
}


def test_workspace_migrations_are_isolated_and_immutable() -> None:
    from dataset_studio.modules.workspaces import migrations as migration_package

    expected_versions = list(range(1, WORKSPACE_SCHEMA_VERSION + 1))
    assert [migration.version for migration in WORKSPACE_MIGRATIONS] == expected_versions
    assert len(WORKSPACE_MIGRATIONS) == WORKSPACE_SCHEMA_VERSION
    assert {
        migration.version: migration.checksum for migration in WORKSPACE_MIGRATIONS
    } == EXPECTED_WORKSPACE_MIGRATION_CHECKSUMS

    expected_modules = {
        f"v{migration.version:03d}_{migration.name}" for migration in WORKSPACE_MIGRATIONS
    }
    discovered_modules = {
        module.name
        for module in pkgutil.iter_modules(migration_package.__path__)
        if module.name.startswith("v")
    }
    assert discovered_modules == expected_modules

    for migration in WORKSPACE_MIGRATIONS:
        module_name = f"v{migration.version:03d}_{migration.name}"
        module = importlib.import_module(f"{migration_package.__name__}.{module_name}")
        migration_instances = [
            value for value in vars(module).values() if isinstance(value, Migration)
        ]
        assert migration_instances == [migration]


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
    assert (
        "mandatory source-specific structure-lock protocol" in translation_prompt["system_prompt"]
    )
    assert versions == [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]


def test_global_download_migration_adds_durable_tagger_queue(tmp_path: Path) -> None:
    database = tmp_path / "global.sqlite3"
    migrate_database(database, GLOBAL_MIGRATIONS[:9])

    initialize_global_database(database)

    connection = connect(database)
    try:
        tables = {
            row["name"]
            for row in connection.execute(
                "SELECT name FROM sqlite_master WHERE type = 'table'"
            ).fetchall()
        }
        indexes = {
            row["name"]
            for row in connection.execute(
                "SELECT name FROM sqlite_master WHERE type = 'index'"
            ).fetchall()
        }
        versions = [
            row["version"]
            for row in connection.execute(
                "SELECT version FROM schema_migrations ORDER BY version"
            ).fetchall()
        ]
    finally:
        connection.close()

    assert {"local_tagger_hf_settings", "local_tagger_downloads"}.issubset(tables)
    assert "idx_local_tagger_downloads_active_plan" in indexes
    assert versions == [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]


def test_translation_prompt_structure_lock_migration_preserves_custom_default(
    tmp_path: Path,
) -> None:
    database = tmp_path / "global.sqlite3"
    migrate_database(database, GLOBAL_MIGRATIONS[:12])
    connection = connect(database)
    try:
        connection.execute(
            """
            UPDATE translation_prompt_presets
            SET system_prompt = 'My customized translation prompt.'
            WHERE id = 'default-translation-prompt'
            """
        )
        connection.commit()
    finally:
        connection.close()

    initialize_global_database(database)

    connection = connect(database)
    try:
        prompt = connection.execute(
            """
            SELECT system_prompt
            FROM translation_prompt_presets
            WHERE id = 'default-translation-prompt'
            """
        ).fetchone()
    finally:
        connection.close()
    assert prompt["system_prompt"] == "My customized translation prompt."


def test_global_dictionary_migration_adds_catalog_overrides_and_download_queue(
    tmp_path: Path,
) -> None:
    database = tmp_path / "global.sqlite3"
    migrate_database(database, GLOBAL_MIGRATIONS[:11])

    initialize_global_database(database)

    connection = connect(database)
    try:
        tables = {
            str(row["name"])
            for row in connection.execute(
                "SELECT name FROM sqlite_master WHERE type = 'table'"
            ).fetchall()
        }
        indexes = {
            str(row["name"])
            for row in connection.execute(
                "SELECT name FROM sqlite_master WHERE type = 'index'"
            ).fetchall()
        }
    finally:
        connection.close()

    assert {
        "local_tag_dictionary_settings",
        "local_tag_dictionary_installations",
        "local_tag_dictionary_overrides",
        "local_tag_dictionary_downloads",
    }.issubset(tables)
    assert "idx_local_tag_dictionary_downloads_active_offer" in indexes


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
    }
    assert activity_projects == ["newer"]


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
            """
            SELECT concurrency, batch_size, selection_json
            FROM local_tagger_profiles
            WHERE id = 'profile'
            """
        ).fetchone()
        assert profile["concurrency"] == 4
        assert profile["batch_size"] is None
        assert json.loads(profile["selection_json"]) == {
            "mode": "global",
            "global_threshold": 0.55,
            "category_thresholds": {},
            "max_tags": None,
        }
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
        job_item_columns = {
            entry["name"]: entry
            for entry in connection.execute("PRAGMA table_info('job_items')").fetchall()
        }
        export_operation_columns = {
            entry["name"]: entry
            for entry in connection.execute("PRAGMA table_info('export_operations')").fetchall()
        }
        export_item_columns = {
            entry["name"]: entry
            for entry in connection.execute("PRAGMA table_info('export_items')").fetchall()
        }
        output_lease_columns = {
            entry["name"]: entry
            for entry in connection.execute(
                "PRAGMA table_info('output_resource_leases')"
            ).fetchall()
        }
        tables = {
            entry["name"]
            for entry in connection.execute(
                "SELECT name FROM sqlite_master WHERE type = 'table'"
            ).fetchall()
        }
        foreign_key_violations = connection.execute("PRAGMA foreign_key_check").fetchall()
    finally:
        connection.close()
    assert row["image_metadata_version"] == 1
    assert versions == list(range(1, WORKSPACE_SCHEMA_VERSION + 1))
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
        "output_resource_leases",
        "annotation_store_state",
        "annotation_documents",
        "annotation_document_revisions",
        "annotation_text_contents",
        "annotation_tag_items",
        "annotation_revision_inputs",
        "job_item_annotation_inputs",
        "legacy_annotation_imports",
    }.issubset(tables)
    assert preprocess_item_columns["phase"]["notnull"] == 1
    assert preprocess_item_columns["phase"]["dflt_value"] == "'committed'"
    assert {
        "planned_route",
        "actual_route",
        "backend_id",
        "decode_location",
        "resize_location",
        "encode_location",
        "route_reason_code",
        "fallback_code",
        "render_duration_ms",
    }.issubset(preprocess_item_columns)
    assert {
        "execution_backend",
        "execution_profile_id",
        "execution_snapshot",
        "output_channel",
        "use_tags_as_context",
    }.issubset(job_columns)
    assert "output_base_revision_id" in job_item_columns
    assert "configuration_snapshot" in export_operation_columns
    assert "artifact_snapshot" in export_item_columns
    assert {"job_item_id", "operation_id", "acquired_at"}.issubset(output_lease_columns)
    assert output_lease_columns["job_item_id"]["notnull"] == 0
    assert foreign_key_violations == []


def test_annotation_store_migration_backfills_existing_job_output_channels(
    tmp_path: Path,
) -> None:
    database = tmp_path / "workspace.sqlite3"
    migrate_database(database, WORKSPACE_MIGRATIONS[:10])
    connection = connect(database)
    try:
        common = {
            "status": "queued",
            "system_preset_id": "preset",
            "system_prompt_snapshot": "{}",
            "provider_profile_id": "provider",
            "provider_snapshot": "{}",
            "user_prompt_snapshot": "",
            "json_fields_snapshot": "[]",
            "scope": "all",
            "created_at": "2026-01-01T00:00:00Z",
            "updated_at": "2026-01-01T00:00:00Z",
        }
        connection.executemany(
            """
            INSERT INTO jobs (
                id, status, system_preset_id, system_prompt_snapshot,
                provider_profile_id, provider_snapshot, user_prompt_snapshot,
                json_fields_snapshot, scope, created_at, updated_at,
                kind, configuration_snapshot, execution_backend,
                execution_profile_id, execution_snapshot
            ) VALUES (
                :id, :status, :system_preset_id, :system_prompt_snapshot,
                :provider_profile_id, :provider_snapshot, :user_prompt_snapshot,
                :json_fields_snapshot, :scope, :created_at, :updated_at,
                :kind, :configuration_snapshot, :execution_backend,
                :execution_profile_id, :execution_snapshot
            )
            """,
            [
                {
                    **common,
                    "id": "provider-annotation",
                    "kind": "annotation",
                    "configuration_snapshot": "{}",
                    "execution_backend": "provider",
                    "execution_profile_id": "provider:model",
                    "execution_snapshot": "{}",
                },
                {
                    **common,
                    "id": "provider-translation",
                    "kind": "translation",
                    "configuration_snapshot": '{"target_language":"zh-CN"}',
                    "execution_backend": "provider",
                    "execution_profile_id": "provider:model",
                    "execution_snapshot": "{}",
                },
                {
                    **common,
                    "id": "local-tagger",
                    "kind": "annotation",
                    "configuration_snapshot": "{}",
                    "execution_backend": "local_tagger",
                    "execution_profile_id": "tagger-profile",
                    "execution_snapshot": "{}",
                },
            ],
        )
        connection.commit()
    finally:
        connection.close()

    migrate_database(database, WORKSPACE_MIGRATIONS[:11])
    connection = connect(database)
    try:
        connection.execute(
            "UPDATE jobs SET use_confirmed_tags = 1 WHERE id = 'provider-annotation'"
        )
        connection.commit()
    finally:
        connection.close()

    initialize_workspace_database(database)

    connection = connect(database)
    try:
        jobs = {
            str(row["id"]): (
                str(row["output_channel"]),
                bool(row["use_tags_as_context"]),
            )
            for row in connection.execute(
                "SELECT id, output_channel, use_tags_as_context FROM jobs ORDER BY id"
            ).fetchall()
        }
    finally:
        connection.close()

    assert jobs == {
        "local-tagger": ("tags", False),
        "provider-annotation": ("description", True),
        "provider-translation": ("translation", False),
    }


def test_review_decoupling_migration_clears_automatic_confirmation_markers(
    tmp_path: Path,
) -> None:
    database = tmp_path / "workspace.sqlite3"
    migrate_database(database, WORKSPACE_MIGRATIONS[:11])
    connection = connect(database)
    try:
        connection.execute(
            """
            INSERT INTO assets (
                id, relative_path, filename, stem, suffix, content_hash,
                byte_size, modified_ns, width, height, annotation_relative_path,
                annotation_status, created_at, updated_at
            ) VALUES (
                'asset', 'sample.png', 'sample.png', 'sample', '.png', 'image-hash',
                1, 1, 32, 32, 'sample.txt',
                'valid', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'
            )
            """
        )
        documents = (
            ("description", "text", "model_response"),
            ("tags", "tags", "local_tagger"),
            ("existing_annotation", "text", "legacy_txt_import"),
        )
        for channel, content_kind, source in documents:
            document_id = f"document-{channel}"
            revision_id = f"revision-{channel}"
            connection.execute(
                """
                INSERT INTO annotation_documents (
                    id, asset_id, channel, language, display_name, content_kind,
                    created_at, updated_at
                ) VALUES (?, 'asset', ?, '', ?, ?, ?, ?)
                """,
                (
                    document_id,
                    channel,
                    channel,
                    content_kind,
                    "2026-01-01T00:00:00Z",
                    "2026-01-01T00:00:00Z",
                ),
            )
            connection.execute(
                """
                INSERT INTO annotation_document_revisions (
                    id, document_id, source, image_content_hash,
                    validation_status, created_at
                ) VALUES (?, ?, ?, 'image-hash', 'valid', ?)
                """,
                (
                    revision_id,
                    document_id,
                    source,
                    "2026-01-01T00:00:00Z",
                ),
            )
            connection.execute(
                """
                UPDATE annotation_documents
                SET head_revision_id = ?, confirmed_revision_id = ?
                WHERE id = ?
                """,
                (revision_id, revision_id, document_id),
            )
        connection.commit()
    finally:
        connection.close()

    initialize_workspace_database(database)

    connection = connect(database)
    try:
        rows = {
            str(row["channel"]): row
            for row in connection.execute(
                """
                SELECT channel, head_revision_id, reviewed_revision_id
                FROM annotation_documents
                """
            ).fetchall()
        }
        foreign_key_violations = connection.execute("PRAGMA foreign_key_check").fetchall()
    finally:
        connection.close()

    assert rows["description"]["reviewed_revision_id"] == rows["description"]["head_revision_id"]
    assert rows["tags"]["reviewed_revision_id"] is None
    assert rows["existing_annotation"]["reviewed_revision_id"] is None
    assert foreign_key_violations == []


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
    assert versions == list(range(1, WORKSPACE_SCHEMA_VERSION + 1))


def test_translation_variant_migration_preserves_history_and_allows_parallel_variants(
    tmp_path: Path,
) -> None:
    database = tmp_path / "workspace.sqlite3"
    migrate_database(database, WORKSPACE_MIGRATIONS[:15])
    now = "2026-07-25T00:00:00Z"
    connection = connect(database)
    try:
        connection.execute(
            """
            INSERT INTO assets (
                id, relative_path, filename, stem, suffix, content_hash,
                byte_size, modified_ns, width, height, annotation_relative_path,
                annotation_status, image_metadata_version, created_at, updated_at
            ) VALUES (
                'asset', 'sample.png', 'sample.png', 'sample', '.png', 'image-hash',
                1, 1, 32, 32, 'sample.txt', 'missing', 1, ?, ?
            )
            """,
            (now, now),
        )
        connection.execute(
            """
            INSERT INTO annotation_documents (
                id, asset_id, channel, language, display_name, content_kind,
                created_at, updated_at
            ) VALUES (
                'legacy-translation', 'asset', 'translation', 'zh-CN',
                '翻译 · zh-CN', 'text', ?, ?
            )
            """,
            (now, now),
        )
        connection.execute(
            """
            INSERT INTO annotation_document_revisions (
                id, document_id, source, image_content_hash,
                validation_status, created_at
            ) VALUES (
                'legacy-revision', 'legacy-translation', 'model_response',
                'image-hash', 'valid', ?
            )
            """,
            (now,),
        )
        connection.execute(
            """
            INSERT INTO annotation_text_contents (revision_id, content)
            VALUES ('legacy-revision', '<caption>旧译文</caption>')
            """
        )
        connection.execute(
            """
            UPDATE annotation_documents
            SET head_revision_id = 'legacy-revision',
                reviewed_revision_id = 'legacy-revision'
            WHERE id = 'legacy-translation'
            """
        )
        connection.commit()
    finally:
        connection.close()

    initialize_workspace_database(database)

    connection = connect(database)
    try:
        migrated = connection.execute(
            """
            SELECT id, translation_source_kind, translation_producer_kind,
                   head_revision_id, reviewed_revision_id
            FROM annotation_documents
            WHERE id = 'legacy-translation'
            """
        ).fetchone()
        content = connection.execute(
            """
            SELECT content
            FROM annotation_text_contents
            WHERE revision_id = 'legacy-revision'
            """
        ).fetchone()
        revision_document = connection.execute(
            """
            SELECT document_id
            FROM annotation_document_revisions
            WHERE id = 'legacy-revision'
            """
        ).fetchone()
        foreign_key_violations = connection.execute("PRAGMA foreign_key_check").fetchall()
    finally:
        connection.close()

    assert migrated is not None
    assert migrated["translation_source_kind"] == "description"
    assert migrated["translation_producer_kind"] == "llm"
    assert migrated["head_revision_id"] == "legacy-revision"
    assert migrated["reviewed_revision_id"] == "legacy-revision"
    assert content["content"] == "<caption>旧译文</caption>"
    assert revision_document["document_id"] == "legacy-translation"
    assert foreign_key_violations == []

    repository = AnnotationRepository(database)
    repository.write_text(
        asset_id="asset",
        channel=AnnotationChannel.TRANSLATION,
        language="zh-CN",
        translation_source_kind="tags",
        translation_producer_kind="llm",
        content="蓝发",
        source="model_response",
        validation_status=AnnotationStatus.VALID,
        image_content_hash="image-hash",
    )
    repository.write_text(
        asset_id="asset",
        channel=AnnotationChannel.TRANSLATION,
        language="zh-CN",
        translation_source_kind="description",
        translation_producer_kind="local_dictionary",
        content="<caption>词典译文</caption>",
        source="local_dictionary",
        validation_status=AnnotationStatus.VALID,
        image_content_hash="image-hash",
    )

    connection = connect(database)
    try:
        variants = [
            (
                row["translation_source_kind"],
                row["translation_producer_kind"],
                row["language"],
            )
            for row in connection.execute(
                """
                SELECT translation_source_kind, translation_producer_kind, language
                FROM annotation_documents
                WHERE asset_id = 'asset' AND channel = 'translation'
                ORDER BY translation_source_kind, translation_producer_kind
                """
            ).fetchall()
        ]
        foreign_key_violations = connection.execute("PRAGMA foreign_key_check").fetchall()
    finally:
        connection.close()

    assert variants == [
        ("description", "llm", "zh-CN"),
        ("description", "local_dictionary", "zh-CN"),
        ("tags", "llm", "zh-CN"),
    ]
    assert foreign_key_violations == []


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
    migrate_database(paths.database, WORKSPACE_MIGRATIONS[:10])
    (root / "sample.txt").write_text("<caption>legacy</caption>", encoding="utf-8")
    connection = connect(paths.database)
    try:
        connection.execute(
            """
            INSERT INTO assets (
                id, relative_path, filename, stem, suffix, content_hash,
                byte_size, modified_ns, width, height, annotation_relative_path,
                annotation_status, created_at, updated_at
            ) VALUES (
                'asset', 'sample.png', 'sample.png', 'sample', '.png', 'image-hash',
                1, 1, 32, 32, 'sample.txt',
                'valid', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'
            )
            """
        )
        connection.commit()
    finally:
        connection.close()
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
        imported = connection.execute(
            """
            SELECT t.content, d.channel, d.reviewed_revision_id, d.head_revision_id
            FROM annotation_documents d
            JOIN annotation_text_contents t ON t.revision_id = d.head_revision_id
            WHERE d.asset_id = 'asset'
            """
        ).fetchone()
    finally:
        connection.close()
    assert versions == list(range(1, WORKSPACE_SCHEMA_VERSION + 1))
    assert imported is not None
    assert imported["content"] == "<caption>legacy</caption>"
    assert imported["channel"] == "existing_annotation"
    assert imported["reviewed_revision_id"] is None


def test_workspace_manifest_accepts_the_legacy_tag_context_setting_name() -> None:
    manifest = WorkspaceManifest.model_validate(
        {
            "project_id": "legacy-project",
            "name": "dataset",
            "created_at": "2026-01-01T00:00:00Z",
            "settings": {"use_confirmed_tags": True},
        }
    )

    assert manifest.settings.use_tags_as_context is True
    serialized_settings = manifest.model_dump()["settings"]
    assert serialized_settings["use_tags_as_context"] is True
    assert "use_confirmed_tags" not in serialized_settings


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
    assert versions == list(range(1, WORKSPACE_SCHEMA_VERSION + 1))


def test_annotation_relation_triggers_reject_cross_asset_revisions(tmp_path: Path) -> None:
    database = tmp_path / "workspace.sqlite3"
    initialize_workspace_database(database)
    now = utc_now_iso()
    connection = connect(database)
    try:
        connection.executemany(
            """
            INSERT INTO assets (
                id, relative_path, filename, stem, suffix, content_hash,
                byte_size, modified_ns, width, height, annotation_relative_path,
                annotation_status, image_metadata_version, created_at, updated_at
            ) VALUES (?, ?, ?, ?, '.png', ?, 1, 1, 32, 32, ?, 'missing', 1, ?, ?)
            """,
            [
                ("asset-a", "a.png", "a.png", "a", "hash-a", "a.txt", now, now),
                ("asset-b", "b.png", "b.png", "b", "hash-b", "b.txt", now, now),
            ],
        )
        connection.commit()
    finally:
        connection.close()

    repository = AnnotationRepository(database)
    first = repository.write_text(
        asset_id="asset-a",
        channel=AnnotationChannel.DESCRIPTION,
        content="<caption>a</caption>",
        source="manual_edit",
        validation_status=AnnotationStatus.VALID,
        image_content_hash="hash-a",
    )
    second = repository.write_text(
        asset_id="asset-b",
        channel=AnnotationChannel.DESCRIPTION,
        content="<caption>b</caption>",
        source="manual_edit",
        validation_status=AnnotationStatus.VALID,
        image_content_hash="hash-b",
    )

    connection = connect(database)
    try:
        with pytest.raises(sqlite3.IntegrityError, match="revision scope mismatch"):
            connection.execute(
                """
                UPDATE annotation_documents
                SET head_revision_id = ?
                WHERE id = ?
                """,
                (second.revision_id, first.document_id),
            )
        with pytest.raises(sqlite3.IntegrityError, match="input asset mismatch"):
            connection.execute(
                """
                INSERT INTO annotation_revision_inputs (
                    output_revision_id, input_revision_id, role
                ) VALUES (?, ?, 'invalid-cross-asset')
                """,
                (first.revision_id, second.revision_id),
            )
    finally:
        connection.close()
