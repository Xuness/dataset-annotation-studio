from __future__ import annotations

from pathlib import Path

from dataset_studio.core.sqlite import connect, transaction


class TaggerRepository:
    def __init__(self, database_path: Path) -> None:
        self._database_path = database_path

    def get_model_root(self) -> str | None:
        connection = connect(self._database_path)
        try:
            row = connection.execute(
                "SELECT model_root FROM local_tagger_settings WHERE id = 1"
            ).fetchone()
            return str(row["model_root"]) if row is not None else None
        finally:
            connection.close()

    def set_model_root(self, model_root: str, updated_at: str) -> None:
        with transaction(self._database_path) as connection:
            connection.execute(
                """
                INSERT INTO local_tagger_settings (id, model_root, updated_at)
                VALUES (1, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    model_root = excluded.model_root,
                    updated_at = excluded.updated_at
                """,
                (model_root, updated_at),
            )

    def list_installations(self):
        connection = connect(self._database_path)
        try:
            return connection.execute(
                """
                SELECT * FROM local_tagger_installations
                ORDER BY name COLLATE NOCASE, model_version COLLATE NOCASE
                """
            ).fetchall()
        finally:
            connection.close()

    def get_installation(self, installation_id: str):
        connection = connect(self._database_path)
        try:
            return connection.execute(
                "SELECT * FROM local_tagger_installations WHERE id = ?",
                (installation_id,),
            ).fetchone()
        finally:
            connection.close()

    def get_installation_by_path(self, relative_path: str):
        connection = connect(self._database_path)
        try:
            return connection.execute(
                "SELECT * FROM local_tagger_installations WHERE relative_path = ?",
                (relative_path,),
            ).fetchone()
        finally:
            connection.close()

    def insert_installation(self, values: tuple[object, ...]) -> None:
        with transaction(self._database_path) as connection:
            connection.execute(
                """
                INSERT INTO local_tagger_installations (
                    id, name, adapter_id, model_version, relative_path,
                    fingerprint, manifest_json, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                values,
            )

    def update_installation(
        self,
        installation_id: str,
        *,
        name: str,
        model_version: str,
        fingerprint: str,
        manifest_json: str,
        updated_at: str,
    ) -> bool:
        with transaction(self._database_path) as connection:
            cursor = connection.execute(
                """
                UPDATE local_tagger_installations
                SET name = ?, model_version = ?, fingerprint = ?,
                    manifest_json = ?, updated_at = ?
                WHERE id = ?
                """,
                (
                    name,
                    model_version,
                    fingerprint,
                    manifest_json,
                    updated_at,
                    installation_id,
                ),
            )
            return cursor.rowcount > 0

    def delete_installation(self, installation_id: str) -> bool:
        with transaction(self._database_path) as connection:
            cursor = connection.execute(
                "DELETE FROM local_tagger_installations WHERE id = ?",
                (installation_id,),
            )
            return cursor.rowcount > 0

    def list_profiles(self):
        connection = connect(self._database_path)
        try:
            return connection.execute(
                """
                SELECT * FROM local_tagger_profiles
                ORDER BY name COLLATE NOCASE
                """
            ).fetchall()
        finally:
            connection.close()

    def get_profile(self, profile_id: str):
        connection = connect(self._database_path)
        try:
            return connection.execute(
                "SELECT * FROM local_tagger_profiles WHERE id = ?",
                (profile_id,),
            ).fetchone()
        finally:
            connection.close()

    def insert_profile(self, values: tuple[object, ...]) -> None:
        with transaction(self._database_path) as connection:
            connection.execute(
                """
                INSERT INTO local_tagger_profiles (
                    id, name, installation_id, threshold, categories_json,
                    device, concurrency, batch_size, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                values,
            )

    def update_profile(self, profile_id: str, values: tuple[object, ...]) -> bool:
        with transaction(self._database_path) as connection:
            cursor = connection.execute(
                """
                UPDATE local_tagger_profiles
                SET name = ?, installation_id = ?, threshold = ?, categories_json = ?,
                    device = ?, concurrency = ?, batch_size = ?, updated_at = ?
                WHERE id = ?
                """,
                (*values, profile_id),
            )
            return cursor.rowcount > 0

    def delete_profile(self, profile_id: str) -> bool:
        with transaction(self._database_path) as connection:
            cursor = connection.execute(
                "DELETE FROM local_tagger_profiles WHERE id = ?",
                (profile_id,),
            )
            return cursor.rowcount > 0
