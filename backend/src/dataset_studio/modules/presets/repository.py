from __future__ import annotations

from pathlib import Path

from dataset_studio.core.sqlite import connect, transaction


class PresetRepository:
    def __init__(self, database_path: Path) -> None:
        self._database_path = database_path

    def list_system(self):
        return self._fetch_all("SELECT * FROM system_presets ORDER BY name COLLATE NOCASE")

    def get_system(self, preset_id: str):
        return self._fetch_one("SELECT * FROM system_presets WHERE id = ?", (preset_id,))

    def insert_system(self, values: tuple[object, ...]) -> None:
        with transaction(self._database_path) as connection:
            connection.execute(
                """
                INSERT INTO system_presets (id, name, system_prompt, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?)
                """,
                values,
            )

    def update_system(self, preset_id: str, name: str, prompt: str, updated_at: str) -> None:
        with transaction(self._database_path) as connection:
            connection.execute(
                """
                UPDATE system_presets
                SET name = ?, system_prompt = ?, updated_at = ?
                WHERE id = ?
                """,
                (name, prompt, updated_at, preset_id),
            )

    def delete_system(self, preset_id: str) -> bool:
        with transaction(self._database_path) as connection:
            cursor = connection.execute("DELETE FROM system_presets WHERE id = ?", (preset_id,))
            return cursor.rowcount > 0

    def list_translation_prompts(self):
        return self._fetch_all(
            """
            SELECT * FROM translation_prompt_presets
            ORDER BY
                CASE WHEN id = 'default-translation-prompt' THEN 0 ELSE 1 END,
                name COLLATE NOCASE
            """
        )

    def get_translation_prompt(self, preset_id: str):
        return self._fetch_one(
            "SELECT * FROM translation_prompt_presets WHERE id = ?",
            (preset_id,),
        )

    def insert_translation_prompt(self, values: tuple[object, ...]) -> None:
        with transaction(self._database_path) as connection:
            connection.execute(
                """
                INSERT INTO translation_prompt_presets (
                    id, name, system_prompt, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?)
                """,
                values,
            )

    def update_translation_prompt(
        self,
        preset_id: str,
        name: str,
        prompt: str,
        updated_at: str,
    ) -> None:
        with transaction(self._database_path) as connection:
            connection.execute(
                """
                UPDATE translation_prompt_presets
                SET name = ?, system_prompt = ?, updated_at = ?
                WHERE id = ?
                """,
                (name, prompt, updated_at, preset_id),
            )

    def delete_translation_prompt(self, preset_id: str) -> bool:
        with transaction(self._database_path) as connection:
            cursor = connection.execute(
                "DELETE FROM translation_prompt_presets WHERE id = ?",
                (preset_id,),
            )
            return cursor.rowcount > 0

    def list_provider(self):
        connection = connect(self._database_path)
        try:
            profiles = connection.execute(
                "SELECT * FROM provider_profiles ORDER BY name COLLATE NOCASE"
            ).fetchall()
            model_rows = connection.execute(
                """
                SELECT *
                FROM provider_model_configs
                ORDER BY provider_profile_id, position
                """
            ).fetchall()
        finally:
            connection.close()
        models_by_profile: dict[str, list[object]] = {}
        for row in model_rows:
            models_by_profile.setdefault(str(row["provider_profile_id"]), []).append(row)
        return [(profile, models_by_profile.get(str(profile["id"]), [])) for profile in profiles]

    def get_provider(self, profile_id: str):
        connection = connect(self._database_path)
        try:
            profile = connection.execute(
                "SELECT * FROM provider_profiles WHERE id = ?",
                (profile_id,),
            ).fetchone()
            if profile is None:
                return None
            models = connection.execute(
                """
                SELECT *
                FROM provider_model_configs
                WHERE provider_profile_id = ?
                ORDER BY position
                """,
                (profile_id,),
            ).fetchall()
            return profile, models
        finally:
            connection.close()

    def insert_provider(
        self,
        values: tuple[object, ...],
        model_values: list[tuple[object, ...]],
    ) -> None:
        with transaction(self._database_path) as connection:
            connection.execute(
                """
                INSERT INTO provider_profiles (
                    id, name, provider_type, base_url, default_model_id,
                    concurrency, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                values,
            )
            connection.executemany(
                """
                INSERT INTO provider_model_configs (
                    provider_profile_id, model_id, position, temperature,
                    max_output_tokens, timeout_seconds, top_p, seed,
                    protocol_options_json
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                model_values,
            )

    def update_provider(
        self,
        profile_id: str,
        values: tuple[object, ...],
        model_values: list[tuple[object, ...]],
    ) -> None:
        with transaction(self._database_path) as connection:
            connection.execute(
                """
                UPDATE provider_profiles
                SET name = ?, provider_type = ?, base_url = ?, default_model_id = ?,
                    concurrency = ?, updated_at = ?
                WHERE id = ?
                """,
                (*values, profile_id),
            )
            connection.execute(
                "DELETE FROM provider_model_configs WHERE provider_profile_id = ?",
                (profile_id,),
            )
            connection.executemany(
                """
                INSERT INTO provider_model_configs (
                    provider_profile_id, model_id, position, temperature,
                    max_output_tokens, timeout_seconds, top_p, seed,
                    protocol_options_json
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                model_values,
            )

    def delete_provider(self, profile_id: str) -> bool:
        with transaction(self._database_path) as connection:
            cursor = connection.execute("DELETE FROM provider_profiles WHERE id = ?", (profile_id,))
            return cursor.rowcount > 0

    def _fetch_all(self, query: str):
        connection = connect(self._database_path)
        try:
            return connection.execute(query).fetchall()
        finally:
            connection.close()

    def _fetch_one(self, query: str, parameters: tuple[object, ...]):
        connection = connect(self._database_path)
        try:
            return connection.execute(query, parameters).fetchone()
        finally:
            connection.close()
