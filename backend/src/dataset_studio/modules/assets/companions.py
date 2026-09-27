from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum
from glob import escape as escape_glob
from pathlib import Path

from dataset_studio.core.languages import LANGUAGE_PATTERN
from dataset_studio.core.paths import filesystem_path_key
from dataset_studio.core.sqlite import connect


class AssetBundleFileKind(StrEnum):
    IMAGE = "image"
    ANNOTATION = "annotation"
    TRANSLATION = "translation"
    METADATA = "metadata"


@dataclass(frozen=True, slots=True)
class AssetCompanion:
    path: Path
    kind: AssetBundleFileKind


def discover_asset_companions(
    image_path: Path,
    claimed_annotation_paths: set[str],
) -> list[AssetCompanion]:
    companions = [
        AssetCompanion(image_path.with_suffix(".txt"), AssetBundleFileKind.ANNOTATION),
        AssetCompanion(image_path.with_suffix(".json"), AssetBundleFileKind.METADATA),
    ]
    prefix = f"{image_path.stem}."
    if image_path.parent.is_dir():
        for candidate in image_path.parent.glob(f"{escape_glob(image_path.stem)}.*.txt"):
            if _path_key(candidate) in claimed_annotation_paths:
                continue
            language = candidate.name[len(prefix) : -len(".txt")]
            if LANGUAGE_PATTERN.fullmatch(language):
                companions.append(AssetCompanion(candidate, AssetBundleFileKind.TRANSLATION))

    unique: dict[str, AssetCompanion] = {}
    for companion in companions:
        unique.setdefault(_path_key(companion.path), companion)
    return list(unique.values())


def path_key(path: Path) -> str:
    return _path_key(path)


def registered_suffixes(database: Path, root: Path, images: tuple[Path, ...]) -> tuple[str, ...]:
    relative_paths = tuple(image.relative_to(root).as_posix() for image in images)
    connection = connect(database)
    try:
        return tuple(
            str(row["role"])
            for row in connection.execute(
                f"SELECT DISTINCT c.role FROM companion_files c JOIN assets a ON a.id=c.asset_id "
                f"WHERE a.relative_path IN ({','.join('?' for _ in relative_paths)})",
                relative_paths,
            )
        )
    finally:
        connection.close()


def _path_key(path: Path) -> str:
    return filesystem_path_key(path)
