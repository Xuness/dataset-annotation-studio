from __future__ import annotations

import hashlib
import json
import sqlite3
from collections.abc import Sequence
from pathlib import Path

from dataset_studio.modules.tag_dictionaries.adapters.base import DICTIONARY_DATABASE_NAME
from dataset_studio.modules.tag_dictionaries.models import (
    TagDictionaryOverride,
    TagDictionaryResolution,
    TagDictionaryResolvedEntry,
    TagDictionarySearchItem,
    TagDictionarySearchResult,
    normalize_tag_key,
)
from dataset_studio.modules.tag_dictionaries.repository import (
    TagDictionaryRepository,
)

_SQLITE_PARAMETER_CHUNK = 800
_BUILTIN_RATING_DICTIONARY = {
    "zh-CN": {
        "general": "一般",
        "sensitive": "敏感",
        "questionable": "可疑",
        "explicit": "露骨",
    }
}
_BUILTIN_RATING_DICTIONARY_ID = "builtin:tagger-ratings"
_BUILTIN_RATING_DICTIONARY_NAME = "内置 Tagger 分级词条"
_BUILTIN_RATING_DICTIONARY_VERSION = "1"


class TagDictionaryResolver:
    def __init__(self, repository: TagDictionaryRepository, dictionary_root) -> None:
        self._repository = repository
        self._dictionary_root = dictionary_root

    def resolve(
        self,
        tags: Sequence[str],
        language: str,
        *,
        categories: Sequence[str | None] | None = None,
    ) -> TagDictionaryResolution:
        requested_tags = [str(tag).strip() for tag in tags]
        if categories is not None and len(categories) != len(requested_tags):
            raise ValueError("Tag 类别数量必须与 Tag 数量一致。")
        requested_categories = (
            [_normalize_category(category) for category in categories]
            if categories is not None
            else [None] * len(requested_tags)
        )
        normalized_by_tag = [
            (tag, normalize_tag_key(tag), category)
            for tag, category in zip(requested_tags, requested_categories, strict=True)
        ]
        unique_keys = list(dict.fromkeys(normalized for _, normalized, _ in normalized_by_tag))
        resolved: dict[str, TagDictionaryResolvedEntry] = {}

        overrides = self._repository.get_overrides(unique_keys, language)
        for row in overrides:
            normalized = str(row["normalized_tag"])
            resolved[normalized] = TagDictionaryResolvedEntry(
                requested_tag=str(row["tag"]),
                normalized_tag=normalized,
                translation=str(row["translation"]),
                matched=True,
                source_kind="override",
                category=str(row["category"]) if row["category"] else None,
                override_revision=int(row["revision"]),
            )

        for installation in self._repository.list_enabled_installations(language):
            unresolved = [key for key in unique_keys if key not in resolved]
            if not unresolved:
                break
            database = self._database_path(installation)
            if not database.is_file() or database.is_symlink():
                continue
            for row in _lookup_many(database, unresolved):
                normalized = str(row["normalized_tag"])
                if normalized in resolved:
                    continue
                resolved[normalized] = TagDictionaryResolvedEntry(
                    requested_tag=str(row["tag"]),
                    normalized_tag=normalized,
                    translation=str(row["translation"]),
                    matched=True,
                    source_kind="dictionary",
                    installation_id=str(installation["id"]),
                    installation_name=str(installation["name"]),
                    adapter_id=str(installation["adapter_id"]),
                    source_version=str(installation["source_version"]),
                    category=str(row["category"]) if row["category"] else None,
                    post_count=int(row["post_count"]) if row["post_count"] is not None else None,
                )

        ordered: list[TagDictionaryResolvedEntry] = []
        for requested_tag, normalized, category in normalized_by_tag:
            matched = resolved.get(normalized)
            if matched is None:
                matched = _builtin_rating_entry(
                    requested_tag,
                    normalized,
                    category,
                    language,
                )
            ordered.append(
                matched.model_copy(update={"requested_tag": requested_tag})
                if matched is not None
                else TagDictionaryResolvedEntry(
                    requested_tag=requested_tag,
                    normalized_tag=normalized,
                    translation=None,
                    matched=False,
                    source_kind="fallback",
                )
            )
        digest = hashlib.sha256(
            json.dumps(
                [entry.model_dump(mode="json") for entry in ordered],
                ensure_ascii=False,
                sort_keys=True,
                separators=(",", ":"),
            ).encode("utf-8")
        ).hexdigest()
        return TagDictionaryResolution(
            language=language,
            entries=ordered,
            resolution_hash=digest,
            unmatched_count=sum(not entry.matched for entry in ordered),
        )

    def search(
        self,
        query: str,
        language: str,
        *,
        offset: int,
        limit: int,
    ) -> TagDictionarySearchResult:
        normalized_query = query.strip().casefold()
        if not normalized_query:
            raise ValueError("词条搜索内容不能为空。")
        candidates: dict[str, str] = {}
        override_rows = self._repository.search_overrides(
            normalized_query,
            language,
            limit + offset,
        )
        for row in override_rows:
            candidates[str(row["normalized_tag"])] = str(row["tag"])
        for installation in self._repository.list_enabled_installations(language):
            database = self._database_path(installation)
            if not database.is_file() or database.is_symlink():
                continue
            for row in _search_database(database, normalized_query, limit + offset):
                candidates.setdefault(str(row["normalized_tag"]), str(row["tag"]))
        ordered_keys = sorted(candidates)
        page_keys = ordered_keys[offset : offset + limit]
        resolution = (
            self.resolve([candidates[key] for key in page_keys], language) if page_keys else None
        )
        override_by_key = {
            str(row["normalized_tag"]): _override_from_row(row) for row in override_rows
        }
        items: list[TagDictionarySearchItem] = []
        for entry in resolution.entries if resolution else []:
            items.append(
                TagDictionarySearchItem(
                    tag=entry.requested_tag,
                    normalized_tag=entry.normalized_tag,
                    effective_translation=entry.translation,
                    source_kind=entry.source_kind,
                    source_name=entry.installation_name,
                    installation_id=entry.installation_id,
                    adapter_id=entry.adapter_id,
                    category=entry.category,
                    post_count=entry.post_count,
                    override=override_by_key.get(entry.normalized_tag),
                )
            )
        return TagDictionarySearchResult(
            query=query.strip(),
            language=language,
            items=items,
            total=len(ordered_keys),
            offset=offset,
            limit=limit,
        )

    def _database_path(self, installation) -> Path:
        root = self._dictionary_root().resolve()
        directory = (root / str(installation["relative_path"])).resolve()
        if not directory.is_relative_to(root):
            return root / "__invalid__"
        return directory / DICTIONARY_DATABASE_NAME


def _normalize_category(category: str | None) -> str | None:
    if category is None:
        return None
    normalized = str(category).strip().casefold()
    return normalized or None


def _builtin_rating_entry(
    requested_tag: str,
    normalized_tag: str,
    category: str | None,
    language: str,
) -> TagDictionaryResolvedEntry | None:
    if category != "rating":
        return None
    translation = _BUILTIN_RATING_DICTIONARY.get(language, {}).get(normalized_tag)
    if translation is None:
        return None
    return TagDictionaryResolvedEntry(
        requested_tag=requested_tag,
        normalized_tag=normalized_tag,
        translation=translation,
        matched=True,
        source_kind="dictionary",
        installation_id=_BUILTIN_RATING_DICTIONARY_ID,
        installation_name=_BUILTIN_RATING_DICTIONARY_NAME,
        adapter_id="builtin_tagger_ratings",
        source_version=_BUILTIN_RATING_DICTIONARY_VERSION,
        category=category,
    )


def _lookup_many(database: Path, normalized_tags: list[str]):
    connection = _read_only(database)
    try:
        rows = []
        for start in range(0, len(normalized_tags), _SQLITE_PARAMETER_CHUNK):
            chunk = normalized_tags[start : start + _SQLITE_PARAMETER_CHUNK]
            placeholders = ", ".join("?" for _ in chunk)
            rows.extend(
                connection.execute(
                    f"""
                    SELECT normalized_tag, tag, translation, category, post_count
                    FROM entries
                    WHERE normalized_tag IN ({placeholders})
                    """,
                    chunk,
                ).fetchall()
            )
        return rows
    except sqlite3.DatabaseError:
        return []
    finally:
        connection.close()


def _search_database(database: Path, query: str, limit: int):
    connection = _read_only(database)
    try:
        pattern = f"%{_escape_like(query)}%"
        return connection.execute(
            """
            SELECT normalized_tag, tag
            FROM entries
            WHERE normalized_tag LIKE ? ESCAPE '\\'
               OR translation LIKE ? ESCAPE '\\'
            ORDER BY
                CASE WHEN normalized_tag = ? THEN 0
                     WHEN normalized_tag LIKE ? ESCAPE '\\' THEN 1
                     ELSE 2 END,
                post_count DESC,
                normalized_tag
            LIMIT ?
            """,
            (pattern, pattern, query, f"{_escape_like(query)}%", limit),
        ).fetchall()
    except sqlite3.DatabaseError:
        return []
    finally:
        connection.close()


def _read_only(path: Path) -> sqlite3.Connection:
    connection = sqlite3.connect(f"file:{path.resolve().as_posix()}?mode=ro", uri=True)
    connection.row_factory = sqlite3.Row
    return connection


def _escape_like(value: str) -> str:
    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def _override_from_row(row) -> TagDictionaryOverride:
    return TagDictionaryOverride(
        tag=str(row["tag"]),
        normalized_tag=str(row["normalized_tag"]),
        translation=str(row["translation"]),
        language=str(row["language"]),
        category=str(row["category"]) if row["category"] else None,
        revision=int(row["revision"]),
        created_at=str(row["created_at"]),
        updated_at=str(row["updated_at"]),
    )
