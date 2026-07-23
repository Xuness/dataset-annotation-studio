from __future__ import annotations

import json
import os
import tempfile
from pathlib import Path, PurePosixPath

from PIL import Image, ImageOps

from dataset_studio.core.errors import AssetNotFoundError
from dataset_studio.modules.assets.models import (
    AssetFolderListResponse,
    AssetFolderSummary,
    AssetIdListResponse,
    AssetListResponse,
    MetadataDocument,
)
from dataset_studio.modules.assets.repository import AssetRepository
from dataset_studio.modules.prompts.composer import escape_metadata_path_segment
from dataset_studio.modules.workspaces.service import WorkspaceService


def _ensure_inside(root: Path, candidate: Path) -> Path:
    resolved = candidate.resolve()
    if not resolved.is_relative_to(root.resolve()):
        raise AssetNotFoundError("素材路径超出当前工作区。")
    return resolved


def _collect_json_fields(value: object, prefix: str = "") -> list[str]:
    fields: list[str] = []
    if isinstance(value, dict):
        for key, child in value.items():
            segment = escape_metadata_path_segment(key)
            path = f"{prefix}.{segment}" if prefix else segment
            fields.append(path)
            fields.extend(_collect_json_fields(child, path))
    return fields


def normalize_folder_path(value: str) -> str:
    if not value:
        return ""
    if "\\" in value:
        raise ValueError("目录路径必须使用工作区相对路径。")
    folder = PurePosixPath(value)
    if folder.is_absolute() or any(part in {"", ".", ".."} for part in folder.parts):
        raise ValueError("目录路径必须位于当前工作区内。")
    return folder.as_posix()


class AssetService:
    def __init__(self, workspaces: WorkspaceService) -> None:
        self._workspaces = workspaces

    def list_assets(
        self,
        project_id: str,
        *,
        search: str = "",
        annotation_status: str | None = None,
        folder_path: str = "",
        offset: int = 0,
        limit: int = 200,
    ) -> AssetListResponse:
        paths, _ = self._workspaces.get(project_id)
        normalized_folder = normalize_folder_path(folder_path)
        items, total, status_counts = AssetRepository(paths.database).list_assets(
            search=search,
            annotation_status=annotation_status,
            folder_path=normalized_folder,
            offset=max(offset, 0),
            limit=min(max(limit, 1), 10_000),
        )
        return AssetListResponse(
            items=items,
            total=total,
            offset=max(offset, 0),
            limit=min(max(limit, 1), 10_000),
            status_counts=status_counts,
        )

    def list_asset_ids(
        self,
        project_id: str,
        *,
        search: str = "",
        annotation_status: str | None = None,
        folder_path: str = "",
    ) -> AssetIdListResponse:
        paths, _ = self._workspaces.get(project_id)
        normalized_folder = normalize_folder_path(folder_path)
        ids = AssetRepository(paths.database).list_asset_ids(
            search=search,
            annotation_status=annotation_status,
            folder_path=normalized_folder,
        )
        return AssetIdListResponse(ids=ids, total=len(ids))

    def list_folders(self, project_id: str) -> AssetFolderListResponse:
        paths, manifest = self._workspaces.get(project_id)
        relative_paths = AssetRepository(paths.database).list_present_paths()
        direct_counts: dict[str, int] = {"": 0}
        descendant_counts: dict[str, int] = {"": 0}

        for relative_path in relative_paths:
            parent = PurePosixPath(relative_path).parent
            folder_path = "" if parent == PurePosixPath(".") else parent.as_posix()
            direct_counts[folder_path] = direct_counts.get(folder_path, 0) + 1
            descendant_counts[""] += 1
            if not folder_path:
                continue
            current = PurePosixPath(folder_path)
            while current != PurePosixPath("."):
                key = current.as_posix()
                descendant_counts[key] = descendant_counts.get(key, 0) + 1
                direct_counts.setdefault(key, 0)
                current = current.parent

        items = [
            AssetFolderSummary(
                path="",
                parent_path=None,
                name=manifest.name,
                direct_asset_count=direct_counts[""],
                descendant_asset_count=descendant_counts[""],
            )
        ]
        for folder_path in sorted(
            (path for path in descendant_counts if path),
            key=lambda value: (value.casefold(), value),
        ):
            folder = PurePosixPath(folder_path)
            parent = folder.parent
            items.append(
                AssetFolderSummary(
                    path=folder_path,
                    parent_path="" if parent == PurePosixPath(".") else parent.as_posix(),
                    name=folder.name,
                    direct_asset_count=direct_counts.get(folder_path, 0),
                    descendant_asset_count=descendant_counts[folder_path],
                )
            )
        return AssetFolderListResponse(items=items)

    def image_path(self, project_id: str, asset_id: str) -> Path:
        paths, _ = self._workspaces.get(project_id)
        asset = self._asset_row(paths.database, asset_id)
        path = _ensure_inside(paths.root, paths.root / str(asset["relative_path"]))
        if not path.is_file():
            raise AssetNotFoundError(f"图片已不存在：{asset['relative_path']}")
        return path

    def thumbnail_path(self, project_id: str, asset_id: str, size: int = 320) -> Path:
        paths, _ = self._workspaces.get(project_id)
        asset = self._asset_row(paths.database, asset_id)
        image_path = _ensure_inside(paths.root, paths.root / str(asset["relative_path"]))
        safe_size = min(max(size, 96), 1024)
        content_key = str(asset["content_hash"])[:24]
        thumbnail_path = paths.thumbnails / f"{asset_id}-{content_key}-{safe_size}.webp"
        if (
            not thumbnail_path.is_file()
            or thumbnail_path.stat().st_mtime_ns < image_path.stat().st_mtime_ns
        ):
            self._create_thumbnail(image_path, thumbnail_path, safe_size)
        return thumbnail_path

    def metadata(self, project_id: str, asset_id: str) -> MetadataDocument:
        paths, _ = self._workspaces.get(project_id)
        asset = self._asset_row(paths.database, asset_id)
        relative_path = asset["metadata_relative_path"]
        if not relative_path:
            return MetadataDocument(exists=False)
        metadata_path = _ensure_inside(paths.root, paths.root / str(relative_path))
        try:
            value = json.loads(metadata_path.read_text(encoding="utf-8"))
        except (OSError, UnicodeError, json.JSONDecodeError) as error:
            return MetadataDocument(
                exists=True,
                path=str(relative_path),
                error=str(error),
            )
        return MetadataDocument(
            exists=True,
            path=str(relative_path),
            value=value,
            fields=_collect_json_fields(value),
        )

    @staticmethod
    def _asset_row(database_path: Path, asset_id: str):
        asset = AssetRepository(database_path).get_asset(asset_id)
        if asset is None:
            raise AssetNotFoundError(f"找不到素材：{asset_id}")
        return asset

    @staticmethod
    def _create_thumbnail(image_path: Path, thumbnail_path: Path, size: int) -> None:
        thumbnail_path.parent.mkdir(parents=True, exist_ok=True)
        descriptor, temporary_name = tempfile.mkstemp(
            prefix=f".{thumbnail_path.stem}.", suffix=".webp", dir=thumbnail_path.parent
        )
        os.close(descriptor)
        temporary_path = Path(temporary_name)
        try:
            with Image.open(image_path) as image:
                image = ImageOps.exif_transpose(image)
                image.thumbnail((size, size), Image.Resampling.LANCZOS)
                if image.mode not in {"RGB", "RGBA"}:
                    image = image.convert("RGBA" if "transparency" in image.info else "RGB")
                image.save(temporary_path, format="WEBP", quality=82, method=4)
            os.replace(temporary_path, thumbnail_path)
        except BaseException:
            temporary_path.unlink(missing_ok=True)
            raise
