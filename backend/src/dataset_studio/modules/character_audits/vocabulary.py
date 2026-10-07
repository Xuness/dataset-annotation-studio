"""User-installed semantic indexes, separate from translation dictionaries."""

from __future__ import annotations

import csv
import hashlib
import json
import shutil
import sqlite3
import tempfile
from collections.abc import Iterator, Sequence
from contextlib import closing
from dataclasses import dataclass
from pathlib import Path

from pydantic import ValidationError

from dataset_studio.core.time import utc_now_iso
from dataset_studio.modules.character_audits.models import (
    VocabularyImport,
    VocabularyLibrary,
    VocabularyManifest,
)
from dataset_studio.modules.tag_dictionaries.models import normalize_tag_key

SOURCE_URL = "https://github.com/storyAura/BooruDatasetTagManagerPlus"
FILES = (
    "danbooru_character_tags.csv",
    "danbooru_dataset_general.csv",
    "danbooru_tag_near_synonyms.csv",
)


class VocabularyError(ValueError):
    """A required semantic resource is missing, malformed, or changed."""


@dataclass(frozen=True, slots=True)
class SemanticTag:
    tag: str
    category: str
    group: str
    parents: tuple[str, ...]
    related: tuple[str, ...]


def file_hash(path: Path) -> str:
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def _rows(path: Path, required: set[str]) -> Iterator[tuple[int, dict[str, str]]]:
    with path.open(encoding="utf-8-sig", newline="") as stream:
        reader = csv.DictReader(stream, strict=True)
        if not required.issubset(set(reader.fieldnames or [])):
            raise VocabularyError(f"{path.name}: 第 1 行缺少字段 {sorted(required)}。")
        try:
            for row in reader:
                if None in row or any(row.get(key) is None for key in required):
                    raise VocabularyError(f"{path.name}: 第 {reader.line_num} 行字段数量不匹配。")
                yield reader.line_num, {key: row[key] for key in required}
        except csv.Error as error:
            raise VocabularyError(
                f"{path.name}: 第 {reader.line_num} 行 CSV 错误：{error}"
            ) from error


def _key(value: str, path: Path, line: int, field: str) -> str:
    try:
        return normalize_tag_key(value)
    except ValueError as error:
        raise VocabularyError(f"{path.name}: 第 {line} 行 {field}: {error}") from error


def _terms(value: str, path: Path, line: int, field: str) -> tuple[str, ...]:
    return tuple(_key(term, path, line, field) for term in value.split(",") if term.strip())


def import_vocabulary(root: Path, request: VocabularyImport) -> VocabularyManifest:
    try:
        source = Path(request.directory).expanduser().resolve(strict=True)
    except OSError as error:
        raise VocabularyError(f"无法读取词表目录 {request.directory}：{error}") from error
    if not source.is_dir():
        raise VocabularyError(f"词表来源不是目录：{source}")
    hashes = []
    for name in FILES:
        path = source / name
        if not path.is_file():
            raise VocabularyError(f"缺少必需词表 {name}，请导入包含全部三个 CSV 的目录。")
        hashes.append(file_hash(path))
    identifier = hashlib.sha256(
        json.dumps(
            ["character-audit-semantic-v1", request.source_version, hashes], ensure_ascii=False
        ).encode()
    ).hexdigest()
    library = root / "character-audits"
    library.mkdir(parents=True, exist_ok=True)
    destination = library / identifier
    if destination.exists():
        return load_manifest(root, identifier)
    with tempfile.TemporaryDirectory(prefix=".import-", dir=library) as temporary:
        staging = Path(temporary)
        originals = staging / "sources"
        originals.mkdir()
        for name, expected in zip(FILES, hashes, strict=True):
            shutil.copyfile(source / name, originals / name)
            if file_hash(originals / name) != expected:
                raise VocabularyError(f"导入期间词表发生变化：{name}，请重新导入。")
        database = staging / "semantic.sqlite3"
        with closing(sqlite3.connect(database)) as connection:
            connection.executescript(
                "CREATE TABLE terms (tag TEXT NOT NULL, category TEXT NOT NULL, "
                "group_name TEXT NOT NULL, parents TEXT NOT NULL, PRIMARY KEY(tag, category));"
                "CREATE TABLE relations (source TEXT NOT NULL, target TEXT NOT NULL, "
                "PRIMARY KEY(source, target));"
                "CREATE INDEX idx_relations_target ON relations(target);"
            )
            counts = []
            for name, tag_field, required in (
                (FILES[0], "character_tag", {"character_tag", "post_count"}),
                (FILES[1], "tag", {"tag", "category", "parent_tag", "category_l1", "post_count"}),
            ):
                count = 0
                path = originals / name
                for line, row in _rows(path, required):
                    tag = _key(row[tag_field], path, line, tag_field)
                    try:
                        if int(row["post_count"]) < 0:
                            raise ValueError("must be nonnegative")
                    except ValueError as error:
                        raise VocabularyError(
                            f"{name}: 第 {line} 行 post_count 不是非负整数。"
                        ) from error
                    parents = _terms(row.get("parent_tag", ""), path, line, "parent_tag")
                    try:
                        connection.execute(
                            "INSERT INTO terms VALUES (?, ?, ?, ?)",
                            (
                                tag,
                                row.get("category", "character"),
                                row.get("category_l1", ""),
                                json.dumps(parents),
                            ),
                        )
                    except sqlite3.IntegrityError as error:
                        raise VocabularyError(f"{name}: 第 {line} 行重复标签 {tag}。") from error
                    count += 1
                if not count:
                    raise VocabularyError(f"{name}: 词表为空。")
                counts.append(count)
            path = originals / FILES[2]
            relation_count = 0
            for line, row in _rows(path, {"tag", "near_synonyms"}):
                tag = _key(row["tag"], path, line, "tag")
                for related in _terms(row["near_synonyms"], path, line, "near_synonyms"):
                    if tag == related:
                        continue
                    relation_count += connection.execute(
                        "INSERT OR IGNORE INTO relations VALUES (?, ?)", (tag, related)
                    ).rowcount
            if not relation_count:
                raise VocabularyError(f"{FILES[2]}: 没有有效关联关系。")
            connection.commit()
        manifest = VocabularyManifest(
            id=identifier,
            source_url=SOURCE_URL,
            source_version=request.source_version,
            license_status="mixed",
            acknowledged_at=utc_now_iso(),
            character_count=counts[0],
            general_count=counts[1],
            relation_count=relation_count,
            database_sha256=file_hash(database),
        )
        (staging / "manifest.json").write_text(manifest.model_dump_json(indent=2), encoding="utf-8")
        try:
            staging.rename(destination)
        except FileExistsError:
            return load_manifest(root, identifier)
    return manifest


def load_manifest(root: Path, identifier: str) -> VocabularyManifest:
    if len(identifier) != 64 or any(char not in "0123456789abcdef" for char in identifier):
        raise VocabularyError("词表安装 ID 无效。")
    directory = root / "character-audits" / identifier
    try:
        manifest = VocabularyManifest.model_validate_json(
            (directory / "manifest.json").read_text(encoding="utf-8")
        )
        if manifest.id != identifier or file_hash(directory / "semantic.sqlite3") != (
            manifest.database_sha256
        ):
            raise VocabularyError(f"词表 {identifier} 完整性校验失败，请重新导入。")
        return manifest
    except (OSError, ValidationError) as error:
        raise VocabularyError(f"无法读取词表 {identifier}：{error}，请重新导入。") from error


def list_vocabularies(root: Path) -> VocabularyLibrary:
    library = root / "character-audits"
    if not library.exists():
        return VocabularyLibrary(installations=[], issues=[])
    installations = []
    issues = []
    for directory in sorted(library.iterdir()):
        if directory.name.startswith(".import-"):
            continue
        try:
            installations.append(load_manifest(root, directory.name))
        except VocabularyError as error:
            issues.append(str(error))
    return VocabularyLibrary(installations=installations, issues=issues)


def resolve_semantics(root: Path, identifier: str, tags: Sequence[str]) -> dict[str, SemanticTag]:
    load_manifest(root, identifier)
    database = root / "character-audits" / identifier / "semantic.sqlite3"
    resolved: dict[str, SemanticTag] = {}
    with closing(sqlite3.connect(f"{database.as_uri()}?mode=ro", uri=True)) as connection:
        for tag in tags:
            key = normalize_tag_key(tag)
            row = connection.execute(
                "SELECT category, group_name, parents FROM terms WHERE tag = ? "
                "ORDER BY CASE WHEN category = 'character' THEN 0 ELSE 1 END, category LIMIT 1",
                (key,),
            ).fetchone()
            related = tuple(
                str(item[0])
                for item in connection.execute(
                    "SELECT target FROM relations WHERE source = ? UNION "
                    "SELECT source FROM relations WHERE target = ?",
                    (key, key),
                )
            )
            resolved[key] = SemanticTag(
                tag=key,
                category=str(row[0]) if row else "general",
                group=str(row[1]) if row else "",
                parents=tuple(json.loads(row[2])) if row else (),
                related=related,
            )
    return resolved
