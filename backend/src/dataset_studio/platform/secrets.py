from __future__ import annotations

from contextlib import suppress
from typing import Protocol

import keyring

from dataset_studio.core.errors import SecretStoreUnavailableError

SERVICE_NAME = "DatasetAnnotationStudio"
_UNAVAILABLE_MESSAGE = (
    "操作系统凭据存储不可用。Linux 请安装并解锁 Secret Service"
    "（例如 GNOME Keyring 或 KWallet），或改用受支持的环境变量凭据。"
)


class SecretStore(Protocol):
    def get(self, key: str) -> str | None: ...

    def set(self, key: str, value: str) -> None: ...

    def delete(self, key: str) -> None: ...


class KeyringSecretStore:
    def get(self, key: str) -> str | None:
        try:
            return keyring.get_password(SERVICE_NAME, key)
        except keyring.errors.KeyringError as error:
            raise SecretStoreUnavailableError(_UNAVAILABLE_MESSAGE) from error

    def set(self, key: str, value: str) -> None:
        try:
            keyring.set_password(SERVICE_NAME, key, value)
        except keyring.errors.KeyringError as error:
            raise SecretStoreUnavailableError(_UNAVAILABLE_MESSAGE) from error

    def delete(self, key: str) -> None:
        try:
            with suppress(keyring.errors.PasswordDeleteError):
                keyring.delete_password(SERVICE_NAME, key)
        except keyring.errors.KeyringError as error:
            raise SecretStoreUnavailableError(_UNAVAILABLE_MESSAGE) from error
