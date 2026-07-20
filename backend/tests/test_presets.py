from pathlib import Path

import pytest
from pydantic import ValidationError

from dataset_studio.modules.presets.models import (
    PromptCacheStrategy,
    ProviderProfileCreate,
    ProviderProfileUpdate,
    ProviderRequestOptions,
    ProviderType,
    SystemPresetCreate,
    TranslationPromptPresetCreate,
    TranslationPromptPresetUpdate,
)
from dataset_studio.modules.presets.repository import PresetRepository
from dataset_studio.modules.presets.service import PresetService
from dataset_studio.platform.global_store import initialize_global_database


class MemorySecrets:
    def __init__(self) -> None:
        self.values: dict[str, str] = {}

    def get(self, key: str) -> str | None:
        return self.values.get(key)

    def set(self, key: str, value: str) -> None:
        self.values[key] = value

    def delete(self, key: str) -> None:
        self.values.pop(key, None)


def _service(tmp_path: Path):
    database = tmp_path / "global.sqlite3"
    initialize_global_database(database)
    repository = PresetRepository(database)
    secrets = MemorySecrets()
    return PresetService(repository, secrets), repository, secrets


def _provider(name: str, api_key: str) -> ProviderProfileCreate:
    return ProviderProfileCreate(
        name=name,
        provider_type=ProviderType.OPENAI_COMPATIBLE,
        base_url="https://example.invalid/v1",
        model="example/model",
        api_key=api_key,
    )


def test_provider_update_restores_secret_when_database_write_fails(
    tmp_path: Path,
    monkeypatch,
) -> None:
    service, repository, _ = _service(tmp_path)
    profile = service.create_provider(_provider("Profile", "old-secret"))

    def fail_update(*_args, **_kwargs):
        raise RuntimeError("simulated database failure")

    monkeypatch.setattr(repository, "update_provider", fail_update)
    with pytest.raises(RuntimeError, match="simulated database failure"):
        service.update_provider(
            profile.id,
            ProviderProfileUpdate(model="changed/model", api_key="new-secret"),
        )

    assert service.get_api_key(profile.id) == "old-secret"
    assert service.get_provider(profile.id).model == "example/model"


def test_duplicate_provider_update_does_not_replace_api_key(tmp_path: Path) -> None:
    service, _, _ = _service(tmp_path)
    first = service.create_provider(_provider("First", "first-secret"))
    service.create_provider(_provider("Second", "second-secret"))

    with pytest.raises(ValueError, match="名称已存在"):
        service.update_provider(
            first.id,
            ProviderProfileUpdate(name="Second", api_key="replacement-secret"),
        )

    assert service.get_api_key(first.id) == "first-secret"
    assert service.get_provider(first.id).name == "First"


def test_empty_api_key_explicitly_clears_saved_secret(tmp_path: Path) -> None:
    service, _, _ = _service(tmp_path)
    profile = service.create_provider(_provider("Profile", "secret"))

    updated = service.update_provider(profile.id, ProviderProfileUpdate(api_key=""))

    assert updated.has_api_key is False
    with pytest.raises(ValueError, match="尚未保存 API Key"):
        service.get_api_key(profile.id)


def test_provider_update_accepts_full_form_with_request_options(tmp_path: Path) -> None:
    service, _, _ = _service(tmp_path)
    profile = service.create_provider(_provider("Profile", "secret"))

    updated = service.update_provider(
        profile.id,
        ProviderProfileUpdate(
            name=profile.name,
            provider_type=profile.provider_type,
            base_url=profile.base_url,
            model=profile.model,
            temperature=profile.temperature,
            max_output_tokens=profile.max_output_tokens,
            concurrency=12,
            timeout_seconds=profile.timeout_seconds,
            request_options=ProviderRequestOptions(
                top_p=0.9,
                seed=42,
                prompt_cache_strategy=PromptCacheStrategy.EXPLICIT_SYSTEM,
            ),
        ),
    )

    assert updated.concurrency == 12
    assert updated.request_options == ProviderRequestOptions(
        top_p=0.9,
        seed=42,
        prompt_cache_strategy=PromptCacheStrategy.EXPLICIT_SYSTEM,
    )
    assert service.get_api_key(profile.id) == "secret"


def test_provider_profile_stores_multiple_models_and_updates_default(tmp_path: Path) -> None:
    service, _, _ = _service(tmp_path)
    profile = service.create_provider(
        ProviderProfileCreate(
            name="Multi-model provider",
            provider_type=ProviderType.OPENAI_COMPATIBLE,
            base_url="https://example.invalid/v1",
            model="vision/default",
            models=["vision/alternate", " vision/default ", "translation/fast"],
            api_key="secret",
        )
    )

    assert profile.model == "vision/default"
    assert profile.models == [
        "vision/default",
        "vision/alternate",
        "translation/fast",
    ]

    replaced = service.update_provider(
        profile.id,
        ProviderProfileUpdate(models=["translation/quality", "vision/new"]),
    )
    assert replaced.model == "translation/quality"
    assert replaced.models == ["translation/quality", "vision/new"]

    switched = service.update_provider(
        profile.id,
        ProviderProfileUpdate(model="vision/new"),
    )
    assert switched.model == "vision/new"
    assert switched.models == ["vision/new", "translation/quality"]
    assert service.get_provider(profile.id).models == switched.models


def test_presets_reject_whitespace_only_required_text() -> None:
    with pytest.raises(ValidationError):
        SystemPresetCreate(name="   ", system_prompt="prompt")
    with pytest.raises(ValidationError):
        TranslationPromptPresetCreate(name="Translation", system_prompt="   ")
    with pytest.raises(ValidationError):
        ProviderProfileCreate(
            name="Profile",
            provider_type=ProviderType.OPENAI_COMPATIBLE,
            base_url="https://example.invalid/v1",
            model="   ",
            api_key="secret",
        )
    with pytest.raises(ValidationError):
        ProviderProfileUpdate(models=[])


def test_translation_prompt_presets_include_editable_default_and_support_crud(
    tmp_path: Path,
) -> None:
    service, _, _ = _service(tmp_path)

    default = service.list_translation_prompts()[0]
    assert default.id == "default-translation-prompt"
    assert "{target_language}" in default.system_prompt

    created = service.create_translation_prompt(
        TranslationPromptPresetCreate(
            name="Concise translation",
            system_prompt="Translate to {target_language} ({language_code}).",
        )
    )
    updated = service.update_translation_prompt(
        created.id,
        TranslationPromptPresetUpdate(
            name="Strict translation",
            system_prompt="Use {language_code}; return only the result.",
        ),
    )
    assert updated.name == "Strict translation"
    assert service.get_translation_prompt(created.id).system_prompt.startswith("Use ")

    service.delete_translation_prompt(created.id)
    assert [preset.id for preset in service.list_translation_prompts()] == [default.id]


def test_codex_profile_uses_no_endpoint_or_project_secret(tmp_path: Path) -> None:
    service, _, secrets = _service(tmp_path)

    profile = service.create_provider(
        ProviderProfileCreate(
            name="Codex subscription",
            provider_type=ProviderType.CODEX,
            base_url="https://should-not-be-stored.invalid",
            model="gpt-example",
            concurrency=1,
        )
    )

    assert profile.base_url == ""
    assert profile.has_api_key is False
    assert service.get_provider_credential(profile) is None
    assert secrets.values == {}


def test_codex_profile_rejects_api_key() -> None:
    with pytest.raises(ValidationError, match="不接受 API Key"):
        ProviderProfileCreate(
            name="Codex subscription",
            provider_type=ProviderType.CODEX,
            model="gpt-example",
            api_key="must-not-be-stored",
        )


def test_switching_api_profile_to_codex_removes_saved_secret(tmp_path: Path) -> None:
    service, _, secrets = _service(tmp_path)
    profile = service.create_provider(_provider("Profile", "secret"))

    updated = service.update_provider(
        profile.id,
        ProviderProfileUpdate(provider_type=ProviderType.CODEX),
    )

    assert updated.provider_type == ProviderType.CODEX
    assert updated.base_url == ""
    assert updated.has_api_key is False
    assert secrets.values == {}
