from __future__ import annotations

from pathlib import Path


def archive_output_path(destination: Path) -> Path:
    name = destination.name or "dataset-export"
    archive_name = name if name.casefold().endswith(".zip") else f"{name}.zip"
    return destination / archive_name
