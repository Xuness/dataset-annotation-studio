from __future__ import annotations

import time
import uuid
from pathlib import Path

from PIL import Image, ImageOps

from dataset_studio.core.files import file_sha256
from dataset_studio.core.time import utc_now_iso
from dataset_studio.modules.annotations.models import AnnotationStatus
from dataset_studio.modules.annotations.text import read_annotation_text
from dataset_studio.modules.assets.models import SUPPORTED_IMAGE_SUFFIXES, AssetRecord
from dataset_studio.modules.assets.repository import AssetRepository
from dataset_studio.modules.workspaces.models import ScanIssue, ScanResult, WorkspaceManifest
from dataset_studio.modules.workspaces.paths import WorkspacePaths


def _image_dimensions(path: Path) -> tuple[int, int]:
    with Image.open(path) as image:
        return ImageOps.exif_transpose(image).size


IMAGE_METADATA_VERSION = 2


class AssetScanner:
    def scan(self, paths: WorkspacePaths, manifest: WorkspaceManifest) -> ScanResult:
        started = time.perf_counter()
        repository = AssetRepository(paths.database)
        existing_by_path = repository.load_all_records()
        annotation_baseline = {
            str(row["id"]): (
                str(row["annotation_status"]),
                int(row["annotation_modified_ns"])
                if row["annotation_modified_ns"] is not None
                else None,
            )
            for row in existing_by_path.values()
        }
        existing_by_casefold: dict[str, list[object]] = {}
        unmatched_by_hash: dict[str, list[object]] = {}
        for row in existing_by_path.values():
            existing_by_casefold.setdefault(str(row["relative_path"]).casefold(), []).append(row)
            unmatched_by_hash.setdefault(str(row["content_hash"]), []).append(row)

        records: list[AssetRecord] = []
        present_ids: set[str] = set()
        updated = 0
        issues: list[ScanIssue] = []
        failed = 0
        scanned_files = 0

        for image_path in self._iter_image_paths(paths, manifest.settings.recursive_scan):
            scanned_files += 1
            try:
                record, was_updated = self._record_for_path(
                    image_path,
                    paths,
                    existing_by_path,
                    existing_by_casefold,
                    unmatched_by_hash,
                    present_ids,
                )
            except (OSError, ValueError, Image.DecompressionBombError) as error:
                failed += 1
                if len(issues) < 200:
                    issues.append(
                        ScanIssue(
                            path=image_path.relative_to(paths.root).as_posix(),
                            message=str(error) or type(error).__name__,
                        )
                    )
                continue
            records.append(record)
            present_ids.add(record.id)
            updated += int(was_updated)

        added, missing = repository.replace_scan(records, present_ids, annotation_baseline)
        return ScanResult(
            scanned_files=scanned_files,
            indexed_assets=len(records),
            added=added,
            updated=updated,
            missing=missing,
            failed=failed,
            issues=issues,
            duration_ms=round((time.perf_counter() - started) * 1000),
        )

    @staticmethod
    def _record_for_path(
        image_path: Path,
        paths: WorkspacePaths,
        existing_by_path,
        existing_by_casefold,
        unmatched_by_hash,
        present_ids: set[str],
    ) -> tuple[AssetRecord, bool]:
        resolved_image_path = image_path.resolve()
        if not resolved_image_path.is_relative_to(paths.root.resolve()):
            raise ValueError("图片不能是指向工作区外部的符号链接。")
        if resolved_image_path.is_relative_to(paths.internal.resolve()):
            raise ValueError("图片不能指向工作区内部状态目录。")
        relative_path = image_path.relative_to(paths.root).as_posix()
        stat = image_path.stat()
        existing = existing_by_path.get(relative_path)
        if existing is None:
            case_matches = existing_by_casefold.get(relative_path.casefold(), [])
            if len(case_matches) == 1:
                previous_path = paths.root / str(case_matches[0]["relative_path"])
                try:
                    if previous_path.is_file() and previous_path.samefile(image_path):
                        existing = case_matches[0]
                except OSError:
                    pass
        path_changed = bool(existing and str(existing["relative_path"]) != relative_path)
        unchanged = bool(
            existing
            and int(existing["byte_size"]) == stat.st_size
            and int(existing["modified_ns"]) == stat.st_mtime_ns
        )
        content_hash = str(existing["content_hash"]) if unchanged else file_sha256(image_path)
        metadata_current = bool(
            existing and int(existing["image_metadata_version"]) >= IMAGE_METADATA_VERSION
        )

        annotation_state_source = existing
        if existing:
            asset_id = str(existing["id"])
            created_at = str(existing["created_at"])
            width, height = (
                (int(existing["width"]), int(existing["height"]))
                if unchanged and metadata_current
                else _image_dimensions(image_path)
            )
            was_updated = path_changed or not unchanged or not metadata_current
        else:
            candidates = [
                row
                for row in unmatched_by_hash.get(content_hash, [])
                if str(row["id"]) not in present_ids
                and not (paths.root / str(row["relative_path"])).is_file()
            ]
            if len(candidates) == 1:
                candidate = candidates[0]
                annotation_state_source = candidate
                asset_id = str(candidate["id"])
                created_at = str(candidate["created_at"])
                candidate_metadata_current = (
                    int(candidate["image_metadata_version"]) >= IMAGE_METADATA_VERSION
                )
                width, height = (
                    (int(candidate["width"]), int(candidate["height"]))
                    if candidate_metadata_current
                    else _image_dimensions(image_path)
                )
                was_updated = True
            else:
                asset_id = str(uuid.uuid4())
                created_at = utc_now_iso()
                width, height = _image_dimensions(image_path)
                was_updated = False

        annotation_path = image_path.with_suffix(".txt")
        metadata_path = image_path.with_suffix(".json")
        if annotation_path.is_symlink():
            raise ValueError("同名标注文件不能是符号链接。")
        if metadata_path.is_symlink():
            raise ValueError("同名元数据文件不能是符号链接。")
        annotation_status, annotation_modified_ns = AssetScanner._annotation_state(
            annotation_path, annotation_state_source
        )
        metadata_relative_path = (
            metadata_path.relative_to(paths.root).as_posix() if metadata_path.is_file() else None
        )
        if existing is not None:
            previous_annotation_modified_ns = (
                int(existing["annotation_modified_ns"])
                if existing["annotation_modified_ns"] is not None
                else None
            )
            was_updated = was_updated or any(
                (
                    str(existing["annotation_status"]) != annotation_status,
                    previous_annotation_modified_ns != annotation_modified_ns,
                    existing["metadata_relative_path"] != metadata_relative_path,
                )
            )
        stat_after = image_path.stat()
        if (stat.st_size, stat.st_mtime_ns) != (stat_after.st_size, stat_after.st_mtime_ns):
            raise ValueError("图片在扫描过程中发生了变化，请重新扫描。")
        updated_at = (
            utc_now_iso()
            if annotation_state_source is None or was_updated
            else str(annotation_state_source["updated_at"])
        )
        return (
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
                metadata_relative_path=metadata_relative_path,
                image_metadata_version=IMAGE_METADATA_VERSION,
                created_at=created_at,
                updated_at=updated_at,
            ),
            was_updated,
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
        _, validation = read_annotation_text(annotation_path)
        return validation.status.value, modified_ns
