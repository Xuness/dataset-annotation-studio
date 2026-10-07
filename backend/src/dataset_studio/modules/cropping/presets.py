import sqlite3
import uuid
from contextlib import closing
from pathlib import Path

from dataset_studio.core.sqlite import connect, transaction
from dataset_studio.modules.cropping.models import Ratio, RatioPreset, RatioPresetInput

BUILTIN_RATIOS = ((1, 1), (4, 3), (3, 4), (3, 2), (2, 3), (16, 9), (9, 16))


def list_presets(database: Path) -> list[RatioPreset]:
    builtins = [
        RatioPreset(
            id=f"builtin-{w}-{h}", name=f"{w}:{h}", ratio=Ratio(width=w, height=h), builtin=True
        )
        for w, h in BUILTIN_RATIOS
    ]
    with closing(connect(database)) as connection:
        rows = connection.execute("SELECT * FROM crop_ratio_presets ORDER BY name").fetchall()
    return builtins + [
        RatioPreset(
            id=str(r["id"]),
            name=str(r["name"]),
            builtin=False,
            ratio=Ratio(width=r["width"], height=r["height"]),
        )
        for r in rows
    ]


def save_preset(database: Path, preset_id: str | None, value: RatioPresetInput) -> RatioPreset:
    if preset_id is not None and preset_id.startswith("builtin-"):
        raise ValueError("内置比例预设只读，不能修改。")
    result = RatioPreset(
        id=preset_id or str(uuid.uuid4()), name=value.name.strip(), ratio=value.ratio, builtin=False
    )
    try:
        with transaction(database) as connection:
            if preset_id is None:
                connection.execute(
                    "INSERT INTO crop_ratio_presets VALUES (?, ?, ?, ?)",
                    (result.id, result.name, result.ratio.width, result.ratio.height),
                )
            else:
                changed = connection.execute(
                    "UPDATE crop_ratio_presets SET name=?, width=?, height=? WHERE id=?",
                    (result.name, result.ratio.width, result.ratio.height, result.id),
                ).rowcount
                if changed != 1:
                    raise ValueError(f"自定义比例预设不存在：{preset_id}")
    except sqlite3.IntegrityError as error:
        raise ValueError(f"比例预设名称已存在：{result.name}") from error
    return result


def delete_preset(database: Path, preset_id: str) -> None:
    if preset_id.startswith("builtin-"):
        raise ValueError("内置比例预设只读，不能删除。")
    with transaction(database) as connection:
        if (
            connection.execute("DELETE FROM crop_ratio_presets WHERE id=?", (preset_id,)).rowcount
            != 1
        ):
            raise ValueError(f"自定义比例预设不存在：{preset_id}")
