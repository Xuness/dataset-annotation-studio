from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

APP_DIR_NAME = "DatasetAnnotationStudio"
WORKSPACE_DIR_NAME = ".annotation-workspace"


def _default_app_data_dir() -> Path:
    local_app_data = os.environ.get("LOCALAPPDATA")
    if local_app_data:
        return Path(local_app_data) / APP_DIR_NAME
    return Path.home() / ".dataset-annotation-studio"


@dataclass(frozen=True, slots=True)
class Settings:
    app_data_dir: Path
    host: str
    port: int
    workspace_dir_name: str = WORKSPACE_DIR_NAME
    thumbnail_size: int = 320

    @classmethod
    def from_environment(cls) -> Settings:
        return cls(
            app_data_dir=Path(
                os.environ.get("DATASET_STUDIO_APP_DATA", _default_app_data_dir())
            ).resolve(),
            host=os.environ.get("DATASET_STUDIO_HOST", "127.0.0.1"),
            port=int(os.environ.get("DATASET_STUDIO_PORT", "8765")),
        )

    def ensure_directories(self) -> None:
        self.app_data_dir.mkdir(parents=True, exist_ok=True)
        (self.app_data_dir / "cache").mkdir(exist_ok=True)
        (self.app_data_dir / "logs").mkdir(exist_ok=True)


settings = Settings.from_environment()
