import json
import sqlite3
from pathlib import Path

import pytest

from dataset_studio.core.migrations import migrate_database
from dataset_studio.core.sqlite import connect
from dataset_studio.platform.global_store import GLOBAL_MIGRATIONS, initialize_global_database


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
    assert "Protocol A: description segment JSON" in translation_prompt["system_prompt"]
    assert "Protocol B: Tags XML envelope" in translation_prompt["system_prompt"]
    assert "application appends" not in translation_prompt["system_prompt"]
    assert versions == list(range(1, len(GLOBAL_MIGRATIONS) + 1))


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
    assert versions == list(range(1, len(GLOBAL_MIGRATIONS) + 1))


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


def test_visible_translation_prompt_migration_expands_previous_default(tmp_path: Path) -> None:
    database = tmp_path / "global.sqlite3"
    migrate_database(database, GLOBAL_MIGRATIONS[:14])

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

    assert "Protocol A: annotation text" in prompt["system_prompt"]
    assert "Protocol B: Tags XML envelope" in prompt["system_prompt"]
    assert '"," must not become "，"' in prompt["system_prompt"]
    assert "Never merge, split, omit, duplicate, or reorder Tags" in prompt["system_prompt"]


def test_segmented_translation_prompt_migration_replaces_strict_punctuation_protocol(
    tmp_path: Path,
) -> None:
    database = tmp_path / "global.sqlite3"
    migrate_database(database, GLOBAL_MIGRATIONS[:14])

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

    assert "Protocol A: description segment JSON" in prompt["system_prompt"]
    assert "Target-language punctuation and spacing may differ" in prompt["system_prompt"]
    assert "Do not leave a value unchanged" in prompt["system_prompt"]
    assert "Do not localize punctuation" not in prompt["system_prompt"]
    assert "application appends" not in prompt["system_prompt"]


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
