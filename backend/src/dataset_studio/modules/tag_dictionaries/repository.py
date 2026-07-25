from __future__ import annotations

from pathlib import Path

from dataset_studio.core.sqlite import connect, transaction


class TagDictionaryRepository:
    def __init__(self, database_path: Path) -> None:
        self._database_path = database_path

    @property
    def database_path(self) -> Path:
        return self._database_path

    def get_dictionary_root(self) -> str | None:
        connection = connect(self._database_path)
        try:
            row = connection.execute(
                "SELECT dictionary_root FROM local_tag_dictionary_settings WHERE id = 1"
            ).fetchone()
            return str(row["dictionary_root"]) if row is not None else None
        finally:
            connection.close()

    def set_dictionary_root(self, dictionary_root: str, updated_at: str) -> None:
        with transaction(self._database_path) as connection:
            connection.execute(
                """
                INSERT INTO local_tag_dictionary_settings (id, dictionary_root, updated_at)
                VALUES (1, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    dictionary_root = excluded.dictionary_root,
                    updated_at = excluded.updated_at
                """,
                (dictionary_root, updated_at),
            )

    def list_installations(self):
        connection = connect(self._database_path)
        try:
            return connection.execute(
                """
                SELECT *
                FROM local_tag_dictionary_installations
                ORDER BY priority, created_at, id
                """
            ).fetchall()
        finally:
            connection.close()

    def list_enabled_installations(self, language: str):
        connection = connect(self._database_path)
        try:
            return connection.execute(
                """
                SELECT *
                FROM local_tag_dictionary_installations
                WHERE enabled = 1 AND language = ?
                ORDER BY priority, created_at, id
                """,
                (language,),
            ).fetchall()
        finally:
            connection.close()

    def get_installation(self, installation_id: str):
        connection = connect(self._database_path)
        try:
            return connection.execute(
                "SELECT * FROM local_tag_dictionary_installations WHERE id = ?",
                (installation_id,),
            ).fetchone()
        finally:
            connection.close()

    def get_installation_by_source(self, source_id: str, source_version: str):
        connection = connect(self._database_path)
        try:
            return connection.execute(
                """
                SELECT *
                FROM local_tag_dictionary_installations
                WHERE source_id = ? AND source_version = ?
                ORDER BY created_at DESC
                LIMIT 1
                """,
                (source_id, source_version),
            ).fetchone()
        finally:
            connection.close()

    def next_priority(self) -> int:
        connection = connect(self._database_path)
        try:
            row = connection.execute(
                "SELECT COALESCE(MAX(priority), -1) + 1 FROM local_tag_dictionary_installations"
            ).fetchone()
            return int(row[0]) if row else 0
        finally:
            connection.close()

    def insert_installation(self, values: tuple[object, ...]) -> None:
        with transaction(self._database_path) as connection:
            connection.execute(
                """
                INSERT INTO local_tag_dictionary_installations (
                    id, name, adapter_id, source_id, source_version, language,
                    relative_path, fingerprint, entry_count, enabled, priority,
                    manifest_json, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                values,
            )

    def update_installation(
        self,
        installation_id: str,
        *,
        name: str,
        enabled: bool,
        updated_at: str,
    ) -> bool:
        with transaction(self._database_path) as connection:
            cursor = connection.execute(
                """
                UPDATE local_tag_dictionary_installations
                SET name = ?, enabled = ?, updated_at = ?
                WHERE id = ?
                """,
                (name, int(enabled), updated_at, installation_id),
            )
            return cursor.rowcount > 0

    def replace_order(self, installation_ids: list[str], updated_at: str) -> None:
        with transaction(self._database_path) as connection:
            rows = connection.execute(
                "SELECT id FROM local_tag_dictionary_installations"
            ).fetchall()
            existing = {str(row["id"]) for row in rows}
            if set(installation_ids) != existing:
                raise ValueError("词典排序必须包含当前全部安装。")
            connection.executemany(
                """
                UPDATE local_tag_dictionary_installations
                SET priority = ?, updated_at = ?
                WHERE id = ?
                """,
                (
                    (priority, updated_at, installation_id)
                    for priority, installation_id in enumerate(installation_ids)
                ),
            )

    def delete_installation(self, installation_id: str) -> bool:
        with transaction(self._database_path) as connection:
            cursor = connection.execute(
                "DELETE FROM local_tag_dictionary_installations WHERE id = ?",
                (installation_id,),
            )
            return cursor.rowcount > 0

    def override_count(self, language: str | None = None) -> int:
        connection = connect(self._database_path)
        try:
            if language is None:
                row = connection.execute(
                    "SELECT COUNT(*) FROM local_tag_dictionary_overrides"
                ).fetchone()
            else:
                row = connection.execute(
                    """
                    SELECT COUNT(*)
                    FROM local_tag_dictionary_overrides
                    WHERE language = ?
                    """,
                    (language,),
                ).fetchone()
            return int(row[0]) if row else 0
        finally:
            connection.close()

    def get_overrides(self, normalized_tags: list[str], language: str):
        if not normalized_tags:
            return []
        connection = connect(self._database_path)
        try:
            placeholders = ", ".join("?" for _ in normalized_tags)
            return connection.execute(
                f"""
                SELECT *
                FROM local_tag_dictionary_overrides
                WHERE language = ? AND normalized_tag IN ({placeholders})
                """,
                (language, *normalized_tags),
            ).fetchall()
        finally:
            connection.close()

    def search_overrides(self, query: str, language: str, limit: int):
        connection = connect(self._database_path)
        try:
            pattern = f"%{_escape_like(query.casefold())}%"
            return connection.execute(
                """
                SELECT *
                FROM local_tag_dictionary_overrides
                WHERE language = ?
                  AND (
                    normalized_tag LIKE ? ESCAPE '\\'
                    OR translation LIKE ? ESCAPE '\\'
                  )
                ORDER BY normalized_tag
                LIMIT ?
                """,
                (language, pattern, pattern, limit),
            ).fetchall()
        finally:
            connection.close()

    def upsert_override(
        self,
        *,
        normalized_tag: str,
        tag: str,
        language: str,
        translation: str,
        category: str | None,
        timestamp: str,
    ):
        with transaction(self._database_path) as connection:
            connection.execute(
                """
                INSERT INTO local_tag_dictionary_overrides (
                    normalized_tag, tag, language, translation, category,
                    revision, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, 1, ?, ?)
                ON CONFLICT(normalized_tag, language) DO UPDATE SET
                    tag = excluded.tag,
                    translation = excluded.translation,
                    category = excluded.category,
                    revision = local_tag_dictionary_overrides.revision + 1,
                    updated_at = excluded.updated_at
                """,
                (
                    normalized_tag,
                    tag,
                    language,
                    translation,
                    category,
                    timestamp,
                    timestamp,
                ),
            )
            return connection.execute(
                """
                SELECT *
                FROM local_tag_dictionary_overrides
                WHERE normalized_tag = ? AND language = ?
                """,
                (normalized_tag, language),
            ).fetchone()

    def delete_override(self, normalized_tag: str, language: str) -> bool:
        with transaction(self._database_path) as connection:
            cursor = connection.execute(
                """
                DELETE FROM local_tag_dictionary_overrides
                WHERE normalized_tag = ? AND language = ?
                """,
                (normalized_tag, language),
            )
            return cursor.rowcount > 0


def _escape_like(value: str) -> str:
    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
