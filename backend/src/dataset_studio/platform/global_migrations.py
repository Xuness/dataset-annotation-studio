from dataset_studio.core.migrations import Migration
from dataset_studio.platform.global_schema_core import (
    GLOBAL_SCHEMA,
    PROVIDER_MODEL_CONFIGS_MIGRATION,
    PROVIDER_MODELS_MIGRATION,
    PROVIDER_REQUEST_OPTIONS_MIGRATION,
    SEGMENTED_TRANSLATION_PROMPT_MIGRATION,
    TRANSLATION_PROMPT_PRESETS_MIGRATION,
    TRANSLATION_PROMPT_STRUCTURE_LOCK_MIGRATION,
    VISIBLE_TRANSLATION_PROMPT_MIGRATION,
)
from dataset_studio.platform.global_schema_workers import (
    CHARACTER_AUDIT_ACTIVITY_MIGRATION,
    LOCAL_TAG_DICTIONARIES_MIGRATION,
    LOCAL_TAGGER_BATCHING_MIGRATION,
    LOCAL_TAGGER_DOWNLOADS_MIGRATION,
    LOCAL_TAGGER_SELECTION_POLICY_MIGRATION,
    LOCAL_TAGGERS_MIGRATION,
    PLATFORM_PATH_IDENTITY_MIGRATION,
    RECENT_WORKSPACE_ACTIVITY_MIGRATION,
    SCREENING_WORKER_ACTIVITY_MIGRATION,
)

GLOBAL_MIGRATIONS = (
    Migration(1, "initial_global_schema", GLOBAL_SCHEMA),
    Migration(2, "provider_request_options", PROVIDER_REQUEST_OPTIONS_MIGRATION),
    Migration(3, "translation_prompt_presets", TRANSLATION_PROMPT_PRESETS_MIGRATION),
    Migration(4, "provider_models", PROVIDER_MODELS_MIGRATION),
    Migration(5, "provider_model_configs", PROVIDER_MODEL_CONFIGS_MIGRATION),
    Migration(6, "local_taggers", LOCAL_TAGGERS_MIGRATION),
    Migration(7, "local_tagger_batching", LOCAL_TAGGER_BATCHING_MIGRATION),
    Migration(
        8,
        "recent_workspace_activity",
        RECENT_WORKSPACE_ACTIVITY_MIGRATION,
    ),
    Migration(
        9,
        "local_tagger_selection_policy",
        LOCAL_TAGGER_SELECTION_POLICY_MIGRATION,
    ),
    Migration(
        10,
        "local_tagger_downloads",
        LOCAL_TAGGER_DOWNLOADS_MIGRATION,
    ),
    Migration(
        11,
        "platform_path_identity",
        PLATFORM_PATH_IDENTITY_MIGRATION,
    ),
    Migration(
        12,
        "local_tag_dictionaries",
        LOCAL_TAG_DICTIONARIES_MIGRATION,
    ),
    Migration(
        13,
        "translation_prompt_structure_lock",
        TRANSLATION_PROMPT_STRUCTURE_LOCK_MIGRATION,
    ),
    Migration(
        14,
        "visible_translation_prompt",
        VISIBLE_TRANSLATION_PROMPT_MIGRATION,
    ),
    Migration(
        15,
        "segmented_translation_prompt",
        SEGMENTED_TRANSLATION_PROMPT_MIGRATION,
    ),
    Migration(
        16,
        "screening_worker_activity",
        SCREENING_WORKER_ACTIVITY_MIGRATION,
        foreign_keys_off=True,
    ),
    Migration(
        17,
        "workspace_locations",
        """
        ALTER TABLE provider_model_configs ADD COLUMN inference_image_max_bytes INTEGER;
        CREATE TABLE workspace_locations (
            project_id TEXT PRIMARY KEY,
            root_path TEXT NOT NULL,
            root_path_key TEXT NOT NULL,
            directory_identity TEXT,
            attached INTEGER NOT NULL DEFAULT 1,
            storage_version INTEGER NOT NULL DEFAULT 0
        );
        INSERT INTO workspace_locations (project_id, root_path, root_path_key)
        SELECT project_id, root_path, COALESCE(root_path_key, root_path) FROM recent_workspaces;
        CREATE INDEX idx_workspace_locations_root ON workspace_locations(root_path_key);
        """,
    ),
    Migration(
        18, "character_audit_activity", CHARACTER_AUDIT_ACTIVITY_MIGRATION, foreign_keys_off=True
    ),
    Migration(
        19,
        "crop_ratio_presets",
        """
        CREATE TABLE crop_ratio_presets (
            id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE,
            width REAL NOT NULL CHECK(width > 0), height REAL NOT NULL CHECK(height > 0)
        );
    """,
    ),
)
