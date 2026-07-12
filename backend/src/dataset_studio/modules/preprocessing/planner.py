from __future__ import annotations

import hashlib
import json
from dataclasses import asdict, dataclass, replace
from pathlib import Path

from PIL import Image, ImageOps

from dataset_studio.core.files import file_sha256
from dataset_studio.core.sqlite import connect
from dataset_studio.modules.preprocessing.models import OutputFormat, PreprocessRequest


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
    if request.asset_ids:
        selected_ids = set(request.asset_ids)
        found_ids = {str(row["id"]) for row in rows}
        missing_count = len(selected_ids - found_ids)
        if missing_count:
            raise ValueError(f"选中的图片中有 {missing_count} 项已不存在，请重新选择。")
    plan: list[PlanItem] = []
    for row in rows:
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
        after_relative = _target_path(before_relative, request)
        target = root / after_relative
        will_change = (
            target_width != width
            or target_height != height
            or after_relative != before_relative
            or request.convert is not None
        )
        warning = (
            f"暂不支持安全处理多帧图片（{frame_count} 帧）：{before_relative}"
            if frame_count > 1 and will_change
            else None
        )
        if warning is None and source.resolve() != target.resolve() and target.exists():
            warning = f"目标文件已经存在：{after_relative}"
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
    for item in plan:
        collisions[item.after_relative_path.casefold()] = (
            collisions.get(item.after_relative_path.casefold(), 0) + 1
        )
    result: list[PlanItem] = []
    for item in plan:
        warning = item.warning
        if collisions[item.after_relative_path.casefold()] > 1 and warning is None:
            warning = f"多个源文件会写入同一目标：{item.after_relative_path}"
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


def _target_path(relative_path: str, request: PreprocessRequest) -> str:
    path = Path(relative_path)
    if request.convert is None:
        return path.as_posix()
    suffix = {
        OutputFormat.WEBP: ".webp",
        OutputFormat.JPEG: ".jpg",
        OutputFormat.PNG: ".png",
    }[request.convert.format]
    return path.with_suffix(suffix).as_posix()
