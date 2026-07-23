from pathlib import Path

import keyring
import pytest

from dataset_studio.core.config import APP_DIR_NAME, _default_app_data_dir
from dataset_studio.core.errors import SecretStoreUnavailableError
from dataset_studio.core.paths import relative_path_key
from dataset_studio.platform.secrets import KeyringSecretStore


def test_default_app_data_directory_matches_platform_conventions() -> None:
    assert (
        _default_app_data_dir(
            environment={"LOCALAPPDATA": r"C:\Users\tester\AppData\Local"},
            platform="win32",
            home=Path(r"C:\Users\tester"),
        )
        == Path(r"C:\Users\tester\AppData\Local") / APP_DIR_NAME
    )
    assert (
        _default_app_data_dir(
            environment={"XDG_DATA_HOME": "/var/lib/tester"},
            platform="linux",
            home=Path("/home/tester"),
        )
        == Path("/var/lib/tester") / APP_DIR_NAME
    )
    assert (
        _default_app_data_dir(
            environment={"XDG_DATA_HOME": "relative-path-is-invalid"},
            platform="linux",
            home=Path("/home/tester"),
        )
        == Path("/home/tester/.local/share") / APP_DIR_NAME
    )
    assert (
        _default_app_data_dir(
            environment={},
            platform="darwin",
            home=Path("/Users/tester"),
        )
        == Path("/Users/tester/Library/Application Support") / APP_DIR_NAME
    )


def test_relative_path_identity_follows_platform_case_policy() -> None:
    assert relative_path_key("Folder/Image.png", case_sensitive=True) != relative_path_key(
        "folder/image.png",
        case_sensitive=True,
    )
    assert relative_path_key("Folder/Image.png", case_sensitive=False) == relative_path_key(
        "folder/image.png",
        case_sensitive=False,
    )


def test_keyring_failure_has_linux_setup_guidance(monkeypatch) -> None:
    def unavailable(*_args):
        raise keyring.errors.NoKeyringError

    monkeypatch.setattr(keyring, "get_password", unavailable)

    with pytest.raises(SecretStoreUnavailableError, match="Secret Service"):
        KeyringSecretStore().get("provider:test")
