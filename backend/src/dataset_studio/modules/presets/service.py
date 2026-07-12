from __future__ import annotations

import sqlite3
import uuid

from dataset_studio.core.errors import PresetNotFoundError
from dataset_studio.core.time import utc_now_iso
from dataset_studio.modules.presets.models import (
    ProviderProfile,
    ProviderProfileCreate,
    ProviderProfileUpdate,
    SystemPreset,
    SystemPresetCreate,
    SystemPresetUpdate,
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
        self._repository.update_system(
            preset_id, updated.name, updated.system_prompt, updated.updated_at
        )
        return updated

    def delete_system(self, preset_id: str) -> None:
        if not self._repository.delete_system(preset_id):
            raise PresetNotFoundError(f"找不到 System Prompt 预设：{preset_id}")

    def list_providers(self) -> list[ProviderProfile]:
        return [self._provider_from_row(row) for row in self._repository.list_provider()]

    def get_provider(self, profile_id: str) -> ProviderProfile:
        row = self._repository.get_provider(profile_id)
        if row is None:
            raise PresetNotFoundError(f"找不到 API 配置：{profile_id}")
        return self._provider_from_row(row)

    def get_api_key(self, profile_id: str) -> str:
        self.get_provider(profile_id)
        api_key = self._secrets.get(self._secret_key(profile_id))
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
            data.base_url.rstrip("/"),
            data.model.strip(),
            data.temperature,
            data.max_output_tokens,
            data.concurrency,
            data.timeout_seconds,
            now,
            now,
        )
        try:
            self._repository.insert_provider(values)
        except sqlite3.IntegrityError as error:
            raise ValueError(f"API 配置名称已存在：{data.name}") from error
        if data.api_key:
            self._secrets.set(self._secret_key(profile_id), data.api_key)
        return self.get_provider(profile_id)

    def update_provider(self, profile_id: str, data: ProviderProfileUpdate) -> ProviderProfile:
        current = self.get_provider(profile_id)
        values = data.model_dump(exclude_none=True, exclude={"api_key"})
        updated = current.model_copy(update=values)
        updated_at = utc_now_iso()
        self._repository.update_provider(
            profile_id,
            (
                updated.name.strip(),
                updated.provider_type.value,
                updated.base_url.rstrip("/"),
                updated.model.strip(),
                updated.temperature,
                updated.max_output_tokens,
                updated.concurrency,
                updated.timeout_seconds,
                updated_at,
            ),
        )
        if data.api_key is not None:
            if data.api_key:
                self._secrets.set(self._secret_key(profile_id), data.api_key)
            else:
                self._secrets.delete(self._secret_key(profile_id))
        return self.get_provider(profile_id)

    def delete_provider(self, profile_id: str) -> None:
        if not self._repository.delete_provider(profile_id):
            raise PresetNotFoundError(f"找不到 API 配置：{profile_id}")
        self._secrets.delete(self._secret_key(profile_id))

    def _provider_from_row(self, row) -> ProviderProfile:
        values = dict(row)
        values["has_api_key"] = bool(self._secrets.get(self._secret_key(str(row["id"]))))
        return ProviderProfile.model_validate(values)

    @staticmethod
    def _secret_key(profile_id: str) -> str:
        return f"provider:{profile_id}"
