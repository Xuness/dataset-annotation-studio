from __future__ import annotations

import json
import sqlite3
import uuid

from dataset_studio.core.errors import PresetNotFoundError
from dataset_studio.core.time import utc_now_iso
from dataset_studio.modules.presets.models import (
    ProviderProfile,
    ProviderProfileCreate,
    ProviderProfileUpdate,
    ProviderRequestOptions,
    ProviderType,
    SystemPreset,
    SystemPresetCreate,
    SystemPresetUpdate,
    TranslationPromptPreset,
    TranslationPromptPresetCreate,
    TranslationPromptPresetUpdate,
)
from dataset_studio.modules.presets.repository import PresetRepository
from dataset_studio.modules.presets.secrets import SecretStore


class PresetService:
    def __init__(self, repository: PresetRepository, secrets: SecretStore) -> None:
        self._repository = repository
        self._secrets = secrets

    def list_system(self) -> list[SystemPreset]:
        return [SystemPreset.model_validate(dict(row)) for row in self._repository.list_system()]

    def get_system(self, preset_id: str) -> SystemPreset:
        row = self._repository.get_system(preset_id)
        if row is None:
            raise PresetNotFoundError(f"找不到 System Prompt 预设：{preset_id}")
        return SystemPreset.model_validate(dict(row))

    def create_system(self, data: SystemPresetCreate) -> SystemPreset:
        now = utc_now_iso()
        preset = SystemPreset(
            id=str(uuid.uuid4()),
            name=data.name.strip(),
            system_prompt=data.system_prompt,
            created_at=now,
            updated_at=now,
        )
        try:
            self._repository.insert_system(
                (preset.id, preset.name, preset.system_prompt, preset.created_at, preset.updated_at)
            )
        except sqlite3.IntegrityError as error:
            raise ValueError(f"预设名称已存在：{preset.name}") from error
        return preset

    def update_system(self, preset_id: str, data: SystemPresetUpdate) -> SystemPreset:
        current = self.get_system(preset_id)
        updated = current.model_copy(update=data.model_dump(exclude_none=True))
        updated = updated.model_copy(
            update={"name": updated.name.strip(), "updated_at": utc_now_iso()}
        )
        try:
            self._repository.update_system(
                preset_id, updated.name, updated.system_prompt, updated.updated_at
            )
        except sqlite3.IntegrityError as error:
            raise ValueError(f"预设名称已存在：{updated.name}") from error
        return updated

    def delete_system(self, preset_id: str) -> None:
        if not self._repository.delete_system(preset_id):
            raise PresetNotFoundError(f"找不到 System Prompt 预设：{preset_id}")

    def list_translation_prompts(self) -> list[TranslationPromptPreset]:
        return [
            TranslationPromptPreset.model_validate(dict(row))
            for row in self._repository.list_translation_prompts()
        ]

    def get_translation_prompt(self, preset_id: str) -> TranslationPromptPreset:
        row = self._repository.get_translation_prompt(preset_id)
        if row is None:
            raise PresetNotFoundError(f"找不到翻译 Prompt 预设：{preset_id}")
        return TranslationPromptPreset.model_validate(dict(row))

    def create_translation_prompt(
        self,
        data: TranslationPromptPresetCreate,
    ) -> TranslationPromptPreset:
        now = utc_now_iso()
        preset = TranslationPromptPreset(
            id=str(uuid.uuid4()),
            name=data.name.strip(),
            system_prompt=data.system_prompt,
            created_at=now,
            updated_at=now,
        )
        try:
            self._repository.insert_translation_prompt(
                (preset.id, preset.name, preset.system_prompt, preset.created_at, preset.updated_at)
            )
        except sqlite3.IntegrityError as error:
            raise ValueError(f"翻译 Prompt 预设名称已存在：{preset.name}") from error
        return preset

    def update_translation_prompt(
        self,
        preset_id: str,
        data: TranslationPromptPresetUpdate,
    ) -> TranslationPromptPreset:
        current = self.get_translation_prompt(preset_id)
        updated = current.model_copy(update=data.model_dump(exclude_none=True))
        updated = updated.model_copy(
            update={"name": updated.name.strip(), "updated_at": utc_now_iso()}
        )
        try:
            self._repository.update_translation_prompt(
                preset_id,
                updated.name,
                updated.system_prompt,
                updated.updated_at,
            )
        except sqlite3.IntegrityError as error:
            raise ValueError(f"翻译 Prompt 预设名称已存在：{updated.name}") from error
        return updated

    def delete_translation_prompt(self, preset_id: str) -> None:
        if not self._repository.delete_translation_prompt(preset_id):
            raise PresetNotFoundError(f"找不到翻译 Prompt 预设：{preset_id}")

    def list_providers(self) -> list[ProviderProfile]:
        return [self._provider_from_row(row) for row in self._repository.list_provider()]

    def get_provider(self, profile_id: str) -> ProviderProfile:
        row = self._repository.get_provider(profile_id)
        if row is None:
            raise PresetNotFoundError(f"找不到 API 配置：{profile_id}")
        return self._provider_from_row(row)

    def get_api_key(self, profile_id: str) -> str:
        profile = self.get_provider(profile_id)
        credential = self.get_provider_credential(profile)
        if credential is None:
            raise ValueError("当前供应商不使用 API Key。")
        return credential

    def get_provider_credential(self, profile: ProviderProfile) -> str | None:
        self.get_provider(profile.id)
        if not profile.provider_type.requires_api_key:
            return None
        api_key = self._secrets.get(self._secret_key(profile.id))
        if not api_key:
            raise ValueError("当前 API 配置尚未保存 API Key。")
        return api_key

    def create_provider(self, data: ProviderProfileCreate) -> ProviderProfile:
        now = utc_now_iso()
        profile_id = str(uuid.uuid4())
        values = (
            profile_id,
            data.name.strip(),
            data.provider_type.value,
            data.base_url.rstrip("/") if data.provider_type.requires_base_url else "",
            data.model.strip(),
            json.dumps(data.models, ensure_ascii=False),
            data.temperature,
            data.max_output_tokens,
            data.concurrency,
            data.timeout_seconds,
            data.request_options.model_dump_json(exclude_none=True),
            now,
            now,
        )
        secret_key = self._secret_key(profile_id)
        if data.api_key:
            self._secrets.set(secret_key, data.api_key)
        try:
            self._repository.insert_provider(values)
        except BaseException as error:
            if data.api_key:
                self._secrets.delete(secret_key)
            if isinstance(error, sqlite3.IntegrityError):
                raise ValueError(f"API 配置名称已存在：{data.name}") from error
            raise
        return self.get_provider(profile_id)

    def update_provider(self, profile_id: str, data: ProviderProfileUpdate) -> ProviderProfile:
        current = self.get_provider(profile_id)
        values = data.model_dump(exclude_none=True, exclude={"api_key"})
        if "models" in values and "model" not in values:
            values["model"] = values["models"][0]
        elif "model" in values and "models" not in values:
            values["models"] = [values["model"], *current.models]
        updated = ProviderProfile.model_validate({**current.model_dump(), **values})
        if not updated.provider_type.requires_base_url:
            updated = updated.model_copy(update={"base_url": ""})
            if data.api_key:
                raise ValueError("Codex 使用自身的 ChatGPT 登录，不接受 API Key。")
        updated_at = utc_now_iso()
        secret_key = self._secret_key(profile_id)
        should_update_secret = (
            data.api_key is not None or not updated.provider_type.requires_api_key
        )
        old_api_key = self._secrets.get(secret_key) if should_update_secret else None
        if not updated.provider_type.requires_api_key:
            self._secrets.delete(secret_key)
        elif data.api_key is not None:
            if data.api_key:
                self._secrets.set(secret_key, data.api_key)
            else:
                self._secrets.delete(secret_key)
        try:
            self._repository.update_provider(
                profile_id,
                self._provider_values(updated, updated_at),
            )
        except BaseException as error:
            if should_update_secret:
                self._restore_secret(secret_key, old_api_key)
            if isinstance(error, sqlite3.IntegrityError):
                raise ValueError(f"API 配置名称已存在：{updated.name}") from error
            raise
        return self.get_provider(profile_id)

    def delete_provider(self, profile_id: str) -> None:
        self.get_provider(profile_id)
        secret_key = self._secret_key(profile_id)
        old_api_key = self._secrets.get(secret_key)
        self._secrets.delete(secret_key)
        try:
            deleted = self._repository.delete_provider(profile_id)
        except BaseException:
            self._restore_secret(secret_key, old_api_key)
            raise
        if not deleted:
            self._restore_secret(secret_key, old_api_key)
            raise PresetNotFoundError(f"找不到 API 配置：{profile_id}")

    def _provider_from_row(self, row) -> ProviderProfile:
        values = dict(row)
        options_json = str(values.pop("request_options_json", "{}"))
        models_json = str(values.pop("models_json", "[]"))
        try:
            values["request_options"] = ProviderRequestOptions.model_validate_json(options_json)
        except ValueError:
            values["request_options"] = ProviderRequestOptions()
        try:
            parsed_models = json.loads(models_json)
            values["models"] = (
                [str(model) for model in parsed_models] if isinstance(parsed_models, list) else []
            )
        except (TypeError, ValueError):
            values["models"] = []
        provider_type = ProviderType(str(values["provider_type"]))
        values["has_api_key"] = provider_type.requires_api_key and bool(
            self._secrets.get(self._secret_key(str(row["id"])))
        )
        return ProviderProfile.model_validate(values)

    @staticmethod
    def _secret_key(profile_id: str) -> str:
        return f"provider:{profile_id}"

    @staticmethod
    def _provider_values(profile: ProviderProfile, updated_at: str) -> tuple[object, ...]:
        return (
            profile.name.strip(),
            profile.provider_type.value,
            profile.base_url.rstrip("/"),
            profile.model.strip(),
            json.dumps(profile.models, ensure_ascii=False),
            profile.temperature,
            profile.max_output_tokens,
            profile.concurrency,
            profile.timeout_seconds,
            profile.request_options.model_dump_json(exclude_none=True),
            updated_at,
        )

    def _restore_secret(self, key: str, value: str | None) -> None:
        if value:
            self._secrets.set(key, value)
        else:
            self._secrets.delete(key)
