from __future__ import annotations

import hashlib
import json
import sqlite3
from collections.abc import Iterable
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

from dataset_studio.modules.tag_dictionaries.models import (
    TagDictionaryAdapterSummary,
    TagDictionaryLicenseStatus,
    normalize_tag_key,
)

DICTIONARY_DATABASE_NAME = "dictionary.sqlite3"
ADAPTER_DATABASE_SCHEMA_VERSION = 1


@dataclass(frozen=True, slots=True)
class NormalizedDictionaryEntry:
    tag: str
    translation: str
    raw_translation: str
    category: str | None = None
    post_count: int | None = None
    aliases: tuple[str, ...] = ()
    quality_flags: tuple[str, ...] = ()

    @property
    def normalized_tag(self) -> str:
        return normalize_tag_key(self.tag)


@dataclass(frozen=True, slots=True)
class ValidatedDictionarySource:
    recommended_name: str
    source_version: str
    language: str
    managed_files: tuple[Path, ...]


@dataclass(frozen=True, slots=True)
class BuiltDictionary:
    entry_count: int
    fingerprint: str


class TagDictionaryAdapter(Protocol):
    id: str
    name: str
    description: str
    contract_version: int
    accepted_inputs: tuple[str, ...]
    source_id: str
    source_url: str
    license_id: str
    license_url: str
    license_status: TagDictionaryLicenseStatus

    def detect(self, source: Path) -> bool: ...

    def validate(self, source: Path) -> ValidatedDictionarySource: ...

    def entries(self, source: Path) -> Iterable[NormalizedDictionaryEntry]: ...

    def summary(self) -> TagDictionaryAdapterSummary: ...


class DictionaryAdapterMixin:
    id: str
    name: str
    description: str
    accepted_inputs: tuple[str, ...]

    def summary(self) -> TagDictionaryAdapterSummary:
        return TagDictionaryAdapterSummary(
            id=self.id,
            name=self.name,
            description=self.description,
            accepted_inputs=list(self.accepted_inputs),
        )


def build_normalized_database(
    target: Path,
    entries: Iterable[NormalizedDictionaryEntry],
    *,
    adapter_id: str,
    adapter_version: int,
    language: str,
) -> BuiltDictionary:
    if target.exists():
        target.unlink()
    target.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(target)
    try:
        connection.execute("PRAGMA journal_mode = WAL")
        connection.execute("PRAGMA synchronous = NORMAL")
        connection.executescript(
            """
            CREATE TABLE dictionary_metadata (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );

            CREATE TABLE entries (
                normalized_tag TEXT PRIMARY KEY,
                tag TEXT NOT NULL,
                translation TEXT NOT NULL,
                raw_translation TEXT NOT NULL,
                category TEXT,
                post_count INTEGER,
                aliases_json TEXT NOT NULL,
                quality_flags_json TEXT NOT NULL
            ) WITHOUT ROWID;

            CREATE INDEX idx_dictionary_entries_tag
            ON entries(tag COLLATE NOCASE);

            CREATE INDEX idx_dictionary_entries_translation
            ON entries(translation COLLATE NOCASE);
            """
        )
        connection.executemany(
            "INSERT INTO dictionary_metadata (key, value) VALUES (?, ?)",
            (
                ("schema_version", str(ADAPTER_DATABASE_SCHEMA_VERSION)),
                ("adapter_id", adapter_id),
                ("adapter_version", str(adapter_version)),
                ("language", language),
            ),
        )
        pending: list[tuple[object, ...]] = []
        for entry in entries:
            tag = entry.tag.strip()
            translation = entry.translation.strip()
            raw_translation = entry.raw_translation.strip()
            if not tag or not translation:
                continue
            if any(character in tag for character in "\r\n\x00"):
                raise ValueError("词典 Tag 不能包含换行或空字符。")
            if any(character in translation for character in "\r\n\x00"):
                raise ValueError(f"词典条目“{tag}”的译文不能包含换行或空字符。")
            pending.append(
                (
                    normalize_tag_key(tag),
                    tag,
                    translation,
                    raw_translation or translation,
                    entry.category,
                    entry.post_count,
                    json.dumps(entry.aliases, ensure_ascii=False),
                    json.dumps(entry.quality_flags, ensure_ascii=False),
                )
            )
            if len(pending) >= 2000:
                _insert_entries(connection, pending)
                pending.clear()
        if pending:
            _insert_entries(connection, pending)
        connection.commit()
        row = connection.execute("SELECT COUNT(*) FROM entries").fetchone()
        entry_count = int(row[0]) if row else 0
        if entry_count <= 0:
            raise ValueError("词典中没有可导入的有效中英词条。")
        fingerprint = _semantic_fingerprint(connection)
        connection.execute(
            "INSERT INTO dictionary_metadata (key, value) VALUES ('fingerprint', ?)",
            (fingerprint,),
        )
        connection.commit()
        integrity = connection.execute("PRAGMA integrity_check").fetchone()
        if integrity is None or str(integrity[0]).lower() != "ok":
            raise ValueError("生成的词典数据库完整性检查失败。")
        connection.execute("PRAGMA wal_checkpoint(TRUNCATE)")
        connection.execute("PRAGMA journal_mode = DELETE")
        return BuiltDictionary(entry_count=entry_count, fingerprint=fingerprint)
    finally:
        connection.close()


def validate_normalized_database(
    path: Path,
    *,
    expected_adapter_id: str | None = None,
    expected_fingerprint: str | None = None,
) -> BuiltDictionary:
    if not path.is_file() or path.is_symlink():
        raise ValueError("词典标准化数据库不存在或路径不安全。")
    connection = sqlite3.connect(f"file:{path.as_posix()}?mode=ro", uri=True)
    try:
        metadata = dict(connection.execute("SELECT key, value FROM dictionary_metadata").fetchall())
        if int(metadata.get("schema_version", "0")) != ADAPTER_DATABASE_SCHEMA_VERSION:
            raise ValueError("词典数据库结构版本不受支持。")
        if expected_adapter_id and metadata.get("adapter_id") != expected_adapter_id:
            raise ValueError("词典数据库适配器与安装清单不一致。")
        row = connection.execute("SELECT COUNT(*) FROM entries").fetchone()
        entry_count = int(row[0]) if row else 0
        if entry_count <= 0:
            raise ValueError("词典数据库没有有效词条。")
        fingerprint = str(metadata.get("fingerprint", ""))
        if len(fingerprint) != 64:
            raise ValueError("词典数据库缺少有效内容指纹。")
        if expected_fingerprint and fingerprint != expected_fingerprint:
            raise ValueError("词典数据库内容指纹与安装清单不一致。")
        integrity = connection.execute("PRAGMA integrity_check").fetchone()
        if integrity is None or str(integrity[0]).lower() != "ok":
            raise ValueError("词典数据库完整性检查失败。")
        return BuiltDictionary(entry_count=entry_count, fingerprint=fingerprint)
    except sqlite3.DatabaseError as error:
        raise ValueError("无法读取词典标准化数据库。") from error
    finally:
        connection.close()


def _insert_entries(connection: sqlite3.Connection, values: list[tuple[object, ...]]) -> None:
    connection.executemany(
        """
        INSERT INTO entries (
            normalized_tag, tag, translation, raw_translation,
            category, post_count, aliases_json, quality_flags_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(normalized_tag) DO UPDATE SET
            tag = excluded.tag,
            translation = excluded.translation,
            raw_translation = excluded.raw_translation,
            category = excluded.category,
            post_count = excluded.post_count,
            aliases_json = excluded.aliases_json,
            quality_flags_json = excluded.quality_flags_json
        """,
        values,
    )


def _semantic_fingerprint(connection: sqlite3.Connection) -> str:
    digest = hashlib.sha256()
    rows = connection.execute(
        """
        SELECT normalized_tag, tag, translation, raw_translation,
               category, post_count, aliases_json, quality_flags_json
        FROM entries
        ORDER BY normalized_tag
        """
    )
    for row in rows:
        payload = json.dumps(list(row), ensure_ascii=False, separators=(",", ":"))
        digest.update(payload.encode("utf-8"))
        digest.update(b"\n")
    return digest.hexdigest()
