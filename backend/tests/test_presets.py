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


def test_presets_reject_whitespace_only_required_text() -> None:
    with pytest.raises(ValidationError):
        SystemPresetCreate(name="   ", system_prompt="prompt")
    with pytest.raises(ValidationError):
        ProviderProfileCreate(
            name="Profile",
            provider_type=ProviderType.OPENAI_COMPATIBLE,
            base_url="https://example.invalid/v1",
            model="   ",
            api_key="secret",
        )
