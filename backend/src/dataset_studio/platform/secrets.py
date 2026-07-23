from __future__ import annotations

from contextlib import suppress
from typing import Protocol

import keyring

SERVICE_NAME = "DatasetAnnotationStudio"


class SecretStore(Protocol):
    def get(self, key: str) -> str | None: ...

    def set(self, key: str, value: str) -> None: ...

    def delete(self, key: str) -> None: ...


class KeyringSecretStore:
    def get(self, key: str) -> str | None:
        return keyring.get_password(SERVICE_NAME, key)

    def set(self, key: str, value: str) -> None:
        keyring.set_password(SERVICE_NAME, key, value)

    def delete(self, key: str) -> None:
        with suppress(keyring.errors.PasswordDeleteError):
            keyring.delete_password(SERVICE_NAME, key)
