from __future__ import annotations

import csv
import json
from pathlib import Path


def validate_managed_files(
    directory: Path,
    required: tuple[str, ...],
    optional: tuple[str, ...] = (),
) -> tuple[str, ...]:
    root = directory.resolve()
    if not root.is_dir():
        raise ValueError("选择的打标器目录不存在。")
    missing = [name for name in required if not (root / name).is_file()]
    if missing:
        raise ValueError("缺少打标器必需文件：" + "、".join(missing))
    managed = tuple(name for name in (*required, *optional) if (root / name).is_file())
    for name in managed:
        candidate = root / name
        path = candidate.resolve()
        if candidate.is_symlink() or not path.is_relative_to(root):
            raise ValueError(f"模型文件路径不安全：{name}")
        if path.stat().st_size <= 0:
            raise ValueError(f"模型文件为空：{name}")
    return managed


def read_json_object(path: Path, label: str) -> dict[str, object]:
    payload = _read_json(path, label)
    if not isinstance(payload, dict):
        raise ValueError(f"{label}必须是 JSON 对象：{path.name}")
    return payload


def read_json_array(path: Path, label: str) -> list[object]:
    payload = _read_json(path, label)
    if not isinstance(payload, list):
        raise ValueError(f"{label}必须是 JSON 数组：{path.name}")
    return payload


def read_csv_rows(
    path: Path,
    *,
    required_columns: frozenset[str],
    label: str,
) -> tuple[dict[str, str], ...]:
    try:
        with path.open("r", encoding="utf-8-sig", newline="") as handle:
            reader = csv.DictReader(handle)
            columns = frozenset(reader.fieldnames or ())
            missing = sorted(required_columns - columns)
            if missing:
                raise ValueError(f"{label}缺少列：" + "、".join(missing))
            return tuple(dict(row) for row in reader)
    except (OSError, UnicodeError, csv.Error) as error:
        raise ValueError(f"无法读取{label}：{path.name}") from error


def _read_json(path: Path, label: str) -> object:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as error:
        raise ValueError(f"无法读取{label}：{path.name}") from error
