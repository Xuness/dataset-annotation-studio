from __future__ import annotations

import os
import sqlite3
import uuid
from collections.abc import Callable, Sequence
from pathlib import Path

from dataset_studio.core.files import atomic_copy_file
from dataset_studio.core.languages import LANGUAGE_PATTERN
from dataset_studio.core.paths import filesystem_path_key
from dataset_studio.core.sqlite import connect, transaction
from dataset_studio.modules.assets.scanner import IMAGE_METADATA_VERSION
from dataset_studio.modules.preprocessing.executor import (
    PreparedItem,
)
from dataset_studio.modules.preprocessing.image_pipeline import sha256
from dataset_studio.modules.preprocessing.models import (
    PreprocessItemPhase,
)
from dataset_studio.modules.preprocessing.planner import PlanItem
from dataset_studio.modules.preprocessing.repository import PreprocessRepository


def _record_item(
    repository: PreprocessRepository,
    root: Path,
    operation_id: str,
    prepared: PreparedItem,
) -> str:
    item = prepared.plan
    observation = prepared.observation
    item_id = str(uuid.uuid4())
    repository.add_item(
        operation_id,
        (
            item_id,
            operation_id,
            item.asset_id,
            item.before_relative_path,
            item.after_relative_path,
            item.before_hash,
            prepared.after_hash,
            item.before_width,
            item.before_height,
            item.after_width,
            item.after_height,
            prepared.recovery_path.relative_to(root).as_posix(),
            PreprocessItemPhase.PREPARED.value,
            observation.planned_route.value if observation else None,
            observation.actual_route.value if observation else None,
            observation.backend_id if observation else None,
            observation.decode_location if observation else None,
            observation.resize_location if observation else None,
            observation.encode_location if observation else None,
            observation.route_reason_code if observation else None,
            observation.fallback_code if observation else None,
            observation.duration_ms if observation else None,
        ),
    )
    return item_id


def _verify_undo(root: Path, database_path: Path, items: Sequence[sqlite3.Row]) -> None:
    claimed_annotations = _claimed_annotation_paths(
        database_path,
        root,
    )
    for item in items:
        current = root / str(item["after_relative_path"])
        before = root / str(item["before_relative_path"])
        original = root / str(item["recovery_relative_path"])
        paths_differ = str(item["before_relative_path"]) != str(item["after_relative_path"])
        if not current.is_file() or sha256(current) != str(item["after_hash"]):
            raise ValueError(
                f"当前文件已在预处理后被修改，无法安全撤销：{item['after_relative_path']}"
            )
        if not original.is_file():
            raise ValueError(f"恢复文件缺失：{item['recovery_relative_path']}")
        if paths_differ and before.exists() and not _same_file(before, current):
            raise ValueError(f"原路径已出现新文件，拒绝覆盖：{item['before_relative_path']}")
        for before_sidecar, after_sidecar, _ in _sidecar_paths(
            before,
            current,
            original,
            claimed_annotations,
        ):
            if after_sidecar.exists() and not after_sidecar.is_file():
                raise ValueError(f"当前同名伴随路径不是文件：{after_sidecar.relative_to(root)}")
            if before_sidecar.exists() and not _same_file(before_sidecar, after_sidecar):
                raise ValueError(
                    f"原同名伴随路径已出现新文件，拒绝覆盖：{before_sidecar.relative_to(root)}"
                )


def _undo_item(
    root: Path,
    database_path: Path,
    item: sqlite3.Row,
    backup: Path,
    update_asset: Callable[[Path, str, Path, Path, str, int, int], None],
) -> None:
    current = root / str(item["after_relative_path"])
    before = root / str(item["before_relative_path"])
    original = root / str(item["recovery_relative_path"])
    paths_differ = str(item["before_relative_path"]) != str(item["after_relative_path"])
    sidecars = _sidecar_paths(
        before,
        current,
        original,
        _claimed_annotation_paths(database_path, root),
    )
    atomic_copy_file(current, backup)
    _backup_current_sidecars(sidecars, backup)
    before_written = False
    try:
        if paths_differ and before.exists() and not _same_file(before, current):
            raise ValueError(f"原路径已出现新文件，拒绝覆盖：{item['before_relative_path']}")
        if paths_differ:
            current.unlink()
        atomic_copy_file(original, before)
        before_written = True
        _undo_sidecars(sidecars)
        update_asset(
            database_path,
            str(item["asset_id"]),
            before,
            root,
            str(item["before_hash"]),
            int(item["before_width"]),
            int(item["before_height"]),
        )
    except BaseException:
        _restore_processed_sidecars(sidecars, backup)
        if before_written and paths_differ:
            before.unlink(missing_ok=True)
        atomic_copy_file(backup, current)
        raise


def _restore_processed_item(
    root: Path,
    database_path: Path,
    item: sqlite3.Row,
    backup: Path,
    update_asset: Callable[[Path, str, Path, Path, str, int, int], None],
) -> None:
    after = root / str(item["after_relative_path"])
    before = root / str(item["before_relative_path"])
    original = root / str(item["recovery_relative_path"])
    paths_differ = str(item["before_relative_path"]) != str(item["after_relative_path"])
    if paths_differ and before.is_file() and sha256(before) != str(item["before_hash"]):
        raise RuntimeError(f"撤销补偿时原路径又被修改：{item['before_relative_path']}")
    _restore_processed_sidecars(
        _sidecar_paths(
            before,
            after,
            original,
            _claimed_annotation_paths(database_path, root),
        ),
        backup,
    )
    if paths_differ:
        before.unlink(missing_ok=True)
    atomic_copy_file(backup, after)
    update_asset(
        database_path,
        str(item["asset_id"]),
        after,
        root,
        str(item["after_hash"]),
        int(item["after_width"]),
        int(item["after_height"]),
    )


def _update_asset(
    database_path: Path,
    asset_id: str,
    image_path: Path,
    root: Path,
    content_hash: str,
    width: int,
    height: int,
) -> None:
    stat = image_path.stat()
    annotation = image_path.with_suffix(".txt")
    metadata = image_path.with_suffix(".json")
    with transaction(database_path) as connection:
        connection.execute(
            """
            UPDATE assets
            SET relative_path = ?, filename = ?, stem = ?, suffix = ?,
                content_hash = ?, byte_size = ?, modified_ns = ?, width = ?, height = ?,
                annotation_relative_path = ?, metadata_relative_path = ?,
                image_metadata_version = ?, is_present = 1
            WHERE id = ?
            """,
            (
                image_path.relative_to(root).as_posix(),
                image_path.name,
                image_path.stem,
                image_path.suffix.lower(),
                content_hash,
                stat.st_size,
                stat.st_mtime_ns,
                width,
                height,
                annotation.relative_to(root).as_posix(),
                metadata.relative_to(root).as_posix() if metadata.is_file() else None,
                IMAGE_METADATA_VERSION,
                asset_id,
            ),
        )
        translation_rows = connection.execute(
            "SELECT language FROM annotation_translations WHERE asset_id = ?",
            (asset_id,),
        ).fetchall()
        for row in translation_rows:
            language = str(row["language"])
            translation = annotation.with_name(f"{annotation.stem}.{language}.txt")
            connection.execute(
                """
                UPDATE annotation_translations
                SET translation_relative_path = ?
                WHERE asset_id = ? AND language = ?
                """,
                (translation.relative_to(root).as_posix(), asset_id, language),
            )


def _rollback(
    root: Path,
    database_path: Path,
    completed: list[tuple[PlanItem, Path]],
) -> None:
    errors: list[str] = []
    claimed_annotations = _claimed_annotation_paths(database_path, root)
    for item, recovery in reversed(completed):
        try:
            after = root / item.after_relative_path
            before = root / item.before_relative_path
            bundle_errors: list[str] = []
            try:
                _restore_original_sidecars(
                    _sidecar_paths(
                        before,
                        after,
                        recovery,
                        claimed_annotations,
                    )
                )
            except Exception as sidecar_error:
                bundle_errors.append(f"伴随文件恢复失败：{sidecar_error}")
            try:
                _restore_file(
                    before,
                    after,
                    recovery,
                    paths_differ=item.before_relative_path != item.after_relative_path,
                )
            except Exception as image_error:
                bundle_errors.append(f"图片恢复失败：{image_error}")
            if bundle_errors:
                raise RuntimeError("；".join(bundle_errors))
            _update_asset(
                database_path,
                item.asset_id,
                before,
                root,
                item.before_hash,
                item.before_width,
                item.before_height,
            )
        except Exception as error:
            errors.append(f"{item.before_relative_path}：{error}")
    if errors:
        raise RuntimeError("；".join(errors))


def _restore_file(
    before: Path,
    after: Path,
    recovery: Path,
    *,
    paths_differ: bool,
) -> None:
    if paths_differ:
        after.unlink(missing_ok=True)
    atomic_copy_file(recovery, before)


def _sidecar_paths(
    before_image: Path,
    after_image: Path,
    recovery_image: Path,
    claimed_annotations: set[str],
) -> list[tuple[Path, Path, Path]]:
    paths: list[tuple[Path, Path, Path]] = [
        (
            before_image.with_suffix(".txt"),
            after_image.with_suffix(".txt"),
            recovery_image.with_suffix(".txt"),
        ),
        (
            before_image.with_suffix(".json"),
            after_image.with_suffix(".json"),
            recovery_image.with_suffix(".json"),
        ),
    ]
    languages = (
        _translation_languages(before_image, claimed_annotations)
        | _translation_languages(after_image, claimed_annotations)
        | _translation_languages(recovery_image, set())
    )
    for language in sorted(languages):
        paths.append(
            (
                before_image.with_name(f"{before_image.stem}.{language}.txt"),
                after_image.with_name(f"{after_image.stem}.{language}.txt"),
                recovery_image.with_name(f"{recovery_image.stem}.{language}.txt"),
            )
        )
    return [
        (before, after, recovery)
        for before, after, recovery in paths
        if before.as_posix() != after.as_posix()
    ]


def _translation_languages(
    image_path: Path,
    claimed_annotations: set[str],
) -> set[str]:
    if not image_path.parent.is_dir():
        return set()
    prefix = f"{image_path.stem}."
    languages: set[str] = set()
    for candidate in image_path.parent.glob(f"{image_path.stem}.*.txt"):
        if _path_key(candidate) in claimed_annotations:
            continue
        language = candidate.name[len(prefix) : -len(".txt")]
        if LANGUAGE_PATTERN.fullmatch(language):
            languages.add(language)
    return languages


def _claimed_annotation_paths(database_path: Path, root: Path) -> set[str]:
    connection = connect(database_path)
    try:
        return {
            _path_key(root / str(row["annotation_relative_path"]))
            for row in connection.execute(
                """
                SELECT annotation_relative_path
                FROM assets
                WHERE is_present = 1
                """
            )
        }
    finally:
        connection.close()


def _path_key(path: Path) -> str:
    return filesystem_path_key(path)


def _same_file(first: Path, second: Path) -> bool:
    if not first.exists() or not second.exists():
        return False
    try:
        return first.samefile(second)
    except OSError:
        return False


def _restore_executed_sidecars(sidecars: list[tuple[Path, Path, Path]]) -> None:
    for before, after, recovery in reversed(sidecars):
        after.unlink(missing_ok=True)
        atomic_copy_file(recovery, before)


def _restore_original_sidecars(sidecars: list[tuple[Path, Path, Path]]) -> None:
    for before, after, recovery in sidecars:
        if recovery.is_file():
            after.unlink(missing_ok=True)
            atomic_copy_file(recovery, before)


def _backup_current_sidecars(
    sidecars: list[tuple[Path, Path, Path]],
    backup_image: Path,
) -> None:
    for _, after, _ in sidecars:
        backup = backup_image.parent / after.name
        if after.is_file():
            atomic_copy_file(after, backup)
        else:
            backup.unlink(missing_ok=True)


def _undo_sidecars(sidecars: list[tuple[Path, Path, Path]]) -> None:
    for before, after, recovery in sidecars:
        if after.is_file():
            before.parent.mkdir(parents=True, exist_ok=True)
            os.replace(after, before)
        elif recovery.is_file():
            atomic_copy_file(recovery, before)


def _restore_processed_sidecars(
    sidecars: list[tuple[Path, Path, Path]],
    backup_image: Path,
) -> None:
    for before, after, recovery in sidecars:
        backup = backup_image.parent / after.name
        if not backup.is_file() and not recovery.is_file():
            continue
        before.unlink(missing_ok=True)
        if backup.is_file():
            atomic_copy_file(backup, after)
