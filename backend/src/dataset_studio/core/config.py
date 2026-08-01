from __future__ import annotations

import os
import sys
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path, PurePosixPath

APP_DIR_NAME = "DatasetAnnotationStudio"
WORKSPACE_DIR_NAME = ".annotation-workspace"


def _default_app_data_dir(
    *,
    environment: Mapping[str, str] | None = None,
    platform: str | None = None,
    home: Path | None = None,
) -> Path:
    environment = os.environ if environment is None else environment
    platform = sys.platform if platform is None else platform
    home = Path.home() if home is None else home

    if platform == "win32":
        base = environment.get("LOCALAPPDATA")
        if base:
            return Path(base) / APP_DIR_NAME
        return home / "AppData" / "Local" / APP_DIR_NAME
    if platform == "darwin":
        return home / "Library" / "Application Support" / APP_DIR_NAME

    xdg_data_home = environment.get("XDG_DATA_HOME")
    if xdg_data_home and PurePosixPath(xdg_data_home).is_absolute():
        return Path(xdg_data_home) / APP_DIR_NAME
    return home / ".local" / "share" / APP_DIR_NAME


@dataclass(frozen=True, slots=True)
class Settings:
    app_data_dir: Path
    host: str
    port: int
    workspace_dir_name: str = WORKSPACE_DIR_NAME
    thumbnail_size: int = 320
    source_root: Path | None = None
    frontend_port: int = 5173
    tagger_idle_timeout_seconds: int = 60

    @classmethod
    def from_environment(cls) -> Settings:
        configured_app_data = os.environ.get("DATASET_STUDIO_APP_DATA")
        configured_source_root = os.environ.get("DATASET_STUDIO_SOURCE_ROOT")
        return cls(
            app_data_dir=Path(configured_app_data or _default_app_data_dir()).resolve(),
            host=os.environ.get("DATASET_STUDIO_HOST", "127.0.0.1"),
            port=int(os.environ.get("DATASET_STUDIO_PORT", "8765")),
            frontend_port=int(os.environ.get("DATASET_STUDIO_FRONTEND_PORT", "5173")),
            source_root=(
                Path(configured_source_root).resolve() if configured_source_root else None
            ),
            tagger_idle_timeout_seconds=int(
                os.environ.get("DATASET_STUDIO_TAGGER_IDLE_TIMEOUT", "60")
            ),
        )

    def ensure_directories(self) -> None:
        self.app_data_dir.mkdir(parents=True, exist_ok=True)
        (self.app_data_dir / "cache").mkdir(exist_ok=True)
        (self.app_data_dir / "logs").mkdir(exist_ok=True)
        (self.app_data_dir / "models" / "taggers").mkdir(parents=True, exist_ok=True)


settings = Settings.from_environment()
