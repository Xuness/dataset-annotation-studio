from __future__ import annotations

import hashlib
import json
import re
from dataclasses import asdict, dataclass, replace
from pathlib import Path

from PIL import Image, ImageOps

from dataset_studio.core.files import file_sha256
from dataset_studio.core.sqlite import connect
from dataset_studio.modules.preprocessing.models import OutputFormat, PreprocessRequest
from dataset_studio.modules.translations.languages import LANGUAGE_PATTERN

_RENAME_FIELD_PATTERN = re.compile(r"\{(name|index)\}")
_WINDOWS_RESERVED_NAMES = {
    "CON",
    "PRN",
    "AUX",
    "NUL",
    *(f"COM{index}" for index in range(1, 10)),
    *(f"LPT{index}" for index in range(1, 10)),
}
_INVALID_FILENAME_CHARACTERS = frozenset('<>:"/\\|?*')


@dataclass(frozen=True, slots=True)
class PlanItem:
    asset_id: str
    before_relative_path: str
    after_relative_path: str
    before_width: int
    before_height: int
    after_width: int
    after_height: int
    before_hash: str
    will_change: bool
    warning: str | None


def build_plan(database_path: Path, root: Path, request: PreprocessRequest) -> list[PlanItem]:
    rows = _select_assets(database_path, request.asset_ids)
    claimed_annotations = _claimed_annotation_paths(database_path, root)
    if request.asset_ids:
        selected_ids = set(request.asset_ids)
        found_ids = {str(row["id"]) for row in rows}
        missing_count = len(selected_ids - found_ids)
        if missing_count:
            raise ValueError(f"选中的图片中有 {missing_count} 项已不存在，请重新选择。")
    plan: list[PlanItem] = []
    for position, row in enumerate(rows):
        before_relative = str(row["relative_path"])
        source = root / before_relative
        if not source.is_file():
            raise ValueError(f"图片已不存在：{before_relative}")
        stat_before = source.stat()
        with Image.open(source) as opened:
            width, height = ImageOps.exif_transpose(opened).size
            frame_count = int(getattr(opened, "n_frames", 1))
        before_hash = file_sha256(source)
        stat_after = source.stat()
        if (stat_before.st_size, stat_before.st_mtime_ns) != (
            stat_after.st_size,
            stat_after.st_mtime_ns,
        ):
            raise ValueError(f"图片正在被其他程序修改，请稍后重试：{before_relative}")
        target_width, target_height = _target_size(width, height, request)
        after_relative = _target_path(before_relative, request, position)
        target = root / after_relative
        requires_render = (
            target_width != width or target_height != height or request.convert is not None
        )
        will_change = requires_render or after_relative != before_relative
        warning = (
            f"暂不支持安全处理多帧图片（{frame_count} 帧）：{before_relative}"
            if frame_count > 1 and requires_render
            else None
        )
        if warning is None and source.resolve() != target.resolve() and target.exists():
            warning = f"目标文件已经存在：{after_relative}"
        if warning is None and request.rename is not None:
            for source_sidecar, target_sidecar in _sidecar_pairs(
                source,
                target,
                claimed_annotations,
            ):
                if source_sidecar.as_posix() != target_sidecar.as_posix() and (
                    (target_sidecar.exists() and not _same_file(source_sidecar, target_sidecar))
                    or (
                        target_sidecar.suffix.lower() == ".txt"
                        and _path_key(target_sidecar) in claimed_annotations
                        and _path_key(target_sidecar) != _path_key(source_sidecar)
                    )
                ):
                    warning = f"目标同名伴随文件已经存在：{target_sidecar.relative_to(root)}"
                    break
        plan.append(
            PlanItem(
                asset_id=str(row["id"]),
                before_relative_path=before_relative,
                after_relative_path=after_relative,
                before_width=width,
                before_height=height,
                after_width=target_width,
                after_height=target_height,
                before_hash=before_hash,
                will_change=will_change,
                warning=warning,
            )
        )
    collisions: dict[str, int] = {}
    companion_collisions: dict[str, int] = {}
    changed_companion_keys: set[str] = set()
    for item in plan:
        collisions[item.after_relative_path.casefold()] = (
            collisions.get(item.after_relative_path.casefold(), 0) + 1
        )
        before_companion = Path(item.before_relative_path).with_suffix("").as_posix()
        after_companion = Path(item.after_relative_path).with_suffix("").as_posix()
        companion_key = after_companion.casefold()
        companion_collisions[companion_key] = companion_collisions.get(companion_key, 0) + 1
        if before_companion != after_companion:
            changed_companion_keys.add(companion_key)
    result: list[PlanItem] = []
    for item in plan:
        warning = item.warning
        if collisions[item.after_relative_path.casefold()] > 1 and warning is None:
            warning = f"多个源文件会写入同一目标：{item.after_relative_path}"
        companion_key = Path(item.after_relative_path).with_suffix("").as_posix().casefold()
        if (
            companion_key in changed_companion_keys
            and companion_collisions[companion_key] > 1
            and warning is None
        ):
            warning = f"多个源文件会共用同名标注或元数据：{companion_key}"
        result.append(replace(item, warning=warning))
    return result


def preview_token(request: PreprocessRequest, plan: list[PlanItem]) -> str:
    payload = {
        "request": request.model_dump(mode="json"),
        "items": [asdict(item) for item in plan],
    }
    encoded = json.dumps(
        payload,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def _select_assets(database_path: Path, asset_ids: list[str]):
    connection = connect(database_path)
    try:
        if not asset_ids:
            return connection.execute(
                "SELECT * FROM assets WHERE is_present = 1 ORDER BY relative_path"
            ).fetchall()
        unique_ids = list(dict.fromkeys(asset_ids))
        rows = []
        for start in range(0, len(unique_ids), 500):
            batch = unique_ids[start : start + 500]
            placeholders = ",".join("?" for _ in batch)
            rows.extend(
                connection.execute(
                    f"""
                    SELECT * FROM assets
                    WHERE is_present = 1 AND id IN ({placeholders})
                    """,
                    batch,
                ).fetchall()
            )
        return sorted(rows, key=lambda row: str(row["relative_path"]).casefold())
    finally:
        connection.close()


def _target_size(width: int, height: int, request: PreprocessRequest) -> tuple[int, int]:
    if request.resize is None:
        return width, height
    current_edge = max(width, height)
    should_resize = current_edge > request.resize.max_edge or (
        request.resize.allow_upscale and current_edge != request.resize.max_edge
    )
    if not should_resize:
        return width, height
    scale = request.resize.max_edge / current_edge
    return max(1, round(width * scale)), max(1, round(height * scale))


def _target_path(relative_path: str, request: PreprocessRequest, position: int) -> str:
    path = Path(relative_path)
    if request.rename is not None:
        index = str(request.rename.start_index + position).zfill(request.rename.padding)
        values = {"name": path.stem, "index": index}
        stem = _RENAME_FIELD_PATTERN.sub(
            lambda match: values[match.group(1)], request.rename.template
        )
        _validate_filename(stem, path.suffix)
        path = path.with_name(f"{stem}{path.suffix}")
    if request.convert is None:
        return path.as_posix()
    suffix = {
        OutputFormat.WEBP: ".webp",
        OutputFormat.JPEG: ".jpg",
        OutputFormat.PNG: ".png",
    }[request.convert.format]
    converted = path.with_suffix(suffix)
    _validate_filename(converted.stem, converted.suffix)
    return converted.as_posix()


def _validate_filename(stem: str, suffix: str) -> None:
    filename = f"{stem}{suffix}"
    if not stem or stem in {".", ".."}:
        raise ValueError("重命名后文件名不能为空。")
    if stem.endswith((" ", ".")):
        raise ValueError(f"文件名不能以空格或句点结尾：{filename}")
    if any(character in _INVALID_FILENAME_CHARACTERS or ord(character) < 32 for character in stem):
        raise ValueError(f"文件名包含 Windows 不支持的字符：{filename}")
    reserved_name = stem.split(".", 1)[0].rstrip(" .").upper()
    if reserved_name in _WINDOWS_RESERVED_NAMES:
        raise ValueError(f"文件名是 Windows 保留名称：{filename}")
    if len(filename) > 255:
        raise ValueError(f"文件名超过 255 个字符：{filename}")


def _same_file(first: Path, second: Path) -> bool:
    if not first.exists() or not second.exists():
        return False
    try:
        return first.samefile(second)
    except OSError:
        return False


def _sidecar_pairs(
    source: Path,
    target: Path,
    claimed_annotations: set[str],
) -> list[tuple[Path, Path]]:
    pairs = [
        (source.with_suffix(".txt"), target.with_suffix(".txt")),
        (source.with_suffix(".json"), target.with_suffix(".json")),
    ]
    prefix = f"{source.stem}."
    if source.parent.is_dir():
        for candidate in source.parent.glob(f"{source.stem}.*.txt"):
            if _path_key(candidate) in claimed_annotations:
                continue
            language = candidate.name[len(prefix) : -len(".txt")]
            if LANGUAGE_PATTERN.fullmatch(language):
                pairs.append(
                    (
                        candidate,
                        target.with_name(f"{target.stem}.{language}.txt"),
                    )
                )
    return pairs


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
    return path.resolve().as_posix().casefold()
