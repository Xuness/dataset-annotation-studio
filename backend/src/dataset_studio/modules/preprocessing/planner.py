from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

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
    plan: list[PlanItem] = []
    for row in rows:
        width, height = int(row["width"]), int(row["height"])
        target_width, target_height = _target_size(width, height, request)
        before_relative = str(row["relative_path"])
        after_relative = _target_path(before_relative, request)
        source = root / before_relative
        target = root / after_relative
        warning = None
        if source.resolve() != target.resolve() and target.exists():
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
                before_hash=str(row["content_hash"]),
                will_change=(
                    target_width != width
                    or target_height != height
                    or after_relative != before_relative
                    or request.convert is not None
                ),
                warning=warning,
            )
        )
    return plan


def _select_assets(database_path: Path, asset_ids: list[str]):
    clauses = ["is_present = 1"]
    parameters: list[object] = []
    if asset_ids:
        placeholders = ",".join("?" for _ in asset_ids)
        clauses.append(f"id IN ({placeholders})")
        parameters.extend(asset_ids)
    connection = connect(database_path)
    try:
        return connection.execute(
            f"SELECT * FROM assets WHERE {' AND '.join(clauses)} ORDER BY relative_path",
            parameters,
        ).fetchall()
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
