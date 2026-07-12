from __future__ import annotations

import hashlib
import time
import uuid
from pathlib import Path

from PIL import Image

from dataset_studio.core.time import utc_now_iso
from dataset_studio.modules.annotations.models import AnnotationStatus
from dataset_studio.modules.annotations.tag_balance import validate_tag_balance
from dataset_studio.modules.assets.models import SUPPORTED_IMAGE_SUFFIXES, AssetRecord
from dataset_studio.modules.assets.repository import AssetRepository
from dataset_studio.modules.workspaces.models import ScanResult, WorkspaceManifest
from dataset_studio.modules.workspaces.paths import WorkspacePaths


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while chunk := handle.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def _image_dimensions(path: Path) -> tuple[int, int]:
    with Image.open(path) as image:
        return image.size


class AssetScanner:
    def scan(self, paths: WorkspacePaths, manifest: WorkspaceManifest) -> ScanResult:
        started = time.perf_counter()
        repository = AssetRepository(paths.database)
        existing_by_path = repository.load_all_records()
        unmatched_by_hash: dict[str, list[object]] = {}
        for row in existing_by_path.values():
            unmatched_by_hash.setdefault(str(row["content_hash"]), []).append(row)

        image_paths = list(self._iter_image_paths(paths, manifest.settings.recursive_scan))
        records: list[AssetRecord] = []
        present_ids: set[str] = set()
        updated = 0

        for image_path in image_paths:
            relative_path = image_path.relative_to(paths.root).as_posix()
            stat = image_path.stat()
            existing = existing_by_path.get(relative_path)
            unchanged = bool(
                existing
                and int(existing["byte_size"]) == stat.st_size
                and int(existing["modified_ns"]) == stat.st_mtime_ns
            )
            content_hash = str(existing["content_hash"]) if unchanged else _sha256(image_path)

            if existing:
                asset_id = str(existing["id"])
                created_at = str(existing["created_at"])
                width, height = (
                    (int(existing["width"]), int(existing["height"]))
                    if unchanged
                    else _image_dimensions(image_path)
                )
                if not unchanged:
                    updated += 1
            else:
                candidates = [
                    row
                    for row in unmatched_by_hash.get(content_hash, [])
                    if str(row["id"]) not in present_ids
                ]
                if len(candidates) == 1:
                    candidate = candidates[0]
                    asset_id = str(candidate["id"])
                    created_at = str(candidate["created_at"])
                    width, height = int(candidate["width"]), int(candidate["height"])
                    updated += 1
                else:
                    asset_id = str(uuid.uuid4())
                    created_at = utc_now_iso()
                    width, height = _image_dimensions(image_path)

            annotation_path = image_path.with_suffix(".txt")
            metadata_path = image_path.with_suffix(".json")
            annotation_status, annotation_modified_ns = self._annotation_state(
                annotation_path, existing
            )
            now = utc_now_iso()
            records.append(
                AssetRecord(
                    id=asset_id,
                    relative_path=relative_path,
                    filename=image_path.name,
                    stem=image_path.stem,
                    suffix=image_path.suffix.lower(),
                    content_hash=content_hash,
                    byte_size=stat.st_size,
                    modified_ns=stat.st_mtime_ns,
                    width=width,
                    height=height,
                    annotation_relative_path=annotation_path.relative_to(paths.root).as_posix(),
                    annotation_status=annotation_status,
                    annotation_modified_ns=annotation_modified_ns,
                    metadata_relative_path=(
                        metadata_path.relative_to(paths.root).as_posix()
                        if metadata_path.is_file()
                        else None
                    ),
                    created_at=created_at,
                    updated_at=now,
                )
            )
            present_ids.add(asset_id)

        added, missing = repository.replace_scan(records, present_ids)
        return ScanResult(
            scanned_files=len(image_paths),
            indexed_assets=len(records),
            added=added,
            updated=updated,
            missing=missing,
            duration_ms=round((time.perf_counter() - started) * 1000),
        )

    @staticmethod
    def _iter_image_paths(paths: WorkspacePaths, recursive: bool):
        iterator = paths.root.rglob("*") if recursive else paths.root.glob("*")
        for candidate in iterator:
            if paths.internal in candidate.parents:
                continue
            if candidate.is_file() and candidate.suffix.lower() in SUPPORTED_IMAGE_SUFFIXES:
                yield candidate

    @staticmethod
    def _annotation_state(annotation_path: Path, existing=None) -> tuple[str, int | None]:
        if not annotation_path.is_file():
            return AnnotationStatus.MISSING.value, None
        modified_ns = annotation_path.stat().st_mtime_ns
        if (
            existing is not None
            and str(existing["annotation_status"]) == AnnotationStatus.MANUALLY_ACCEPTED.value
            and existing["annotation_modified_ns"] is not None
            and int(existing["annotation_modified_ns"]) == modified_ns
        ):
            return AnnotationStatus.MANUALLY_ACCEPTED.value, modified_ns
        content = annotation_path.read_text(encoding="utf-8", errors="replace")
        validation = validate_tag_balance(content)
        return validation.status.value, modified_ns
