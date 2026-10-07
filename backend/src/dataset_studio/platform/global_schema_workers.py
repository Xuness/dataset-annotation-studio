LOCAL_TAGGERS_MIGRATION = """
CREATE TABLE local_tagger_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    model_root TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE local_tagger_installations (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    adapter_id TEXT NOT NULL,
    model_version TEXT NOT NULL,
    relative_path TEXT NOT NULL COLLATE NOCASE UNIQUE,
    fingerprint TEXT NOT NULL CHECK (length(fingerprint) = 64),
    manifest_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX idx_local_tagger_installations_adapter
ON local_tagger_installations(adapter_id, model_version);

CREATE TABLE local_tagger_profiles (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL COLLATE NOCASE UNIQUE,
    installation_id TEXT NOT NULL,
    threshold REAL NOT NULL CHECK (threshold >= 0.01 AND threshold <= 0.99),
    categories_json TEXT NOT NULL,
    device TEXT NOT NULL CHECK (device IN ('auto', 'cpu', 'cuda', 'directml')),
    concurrency INTEGER NOT NULL CHECK (concurrency >= 1 AND concurrency <= 8),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (installation_id)
        REFERENCES local_tagger_installations(id) ON DELETE CASCADE
);

CREATE INDEX idx_local_tagger_profiles_installation
ON local_tagger_profiles(installation_id);
"""

LOCAL_TAGGER_BATCHING_MIGRATION = """
ALTER TABLE local_tagger_profiles
ADD COLUMN batch_size INTEGER
CHECK (batch_size IS NULL OR (batch_size >= 1 AND batch_size <= 32));
"""

RECENT_WORKSPACE_ACTIVITY_MIGRATION = """
ALTER TABLE recent_workspaces
ADD COLUMN hidden_at TEXT;

WITH ranked_workspaces AS (
    SELECT
        project_id,
        ROW_NUMBER() OVER (
            PARTITION BY root_path COLLATE NOCASE
            ORDER BY last_opened_at DESC, rowid DESC
        ) AS duplicate_rank
    FROM recent_workspaces
)
UPDATE recent_workspaces
SET hidden_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE project_id IN (
    SELECT project_id
    FROM ranked_workspaces
    WHERE duplicate_rank > 1
);

CREATE UNIQUE INDEX idx_recent_workspaces_visible_root
ON recent_workspaces(root_path COLLATE NOCASE)
WHERE hidden_at IS NULL;

CREATE TABLE worker_workspace_activity (
    project_id TEXT PRIMARY KEY,
    jobs_requested_at TEXT,
    exports_requested_at TEXT,
    FOREIGN KEY (project_id)
        REFERENCES recent_workspaces(project_id) ON DELETE CASCADE,
    CHECK (jobs_requested_at IS NOT NULL OR exports_requested_at IS NOT NULL)
);

INSERT INTO worker_workspace_activity (
    project_id, jobs_requested_at, exports_requested_at
)
SELECT
    project_id,
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM recent_workspaces
WHERE hidden_at IS NULL;
"""

LOCAL_TAGGER_SELECTION_POLICY_MIGRATION = """
ALTER TABLE local_tagger_profiles
ADD COLUMN selection_json TEXT NOT NULL
DEFAULT '{"mode":"global","global_threshold":0.55,"category_thresholds":{},"max_tags":null}';

UPDATE local_tagger_profiles
SET selection_json =
    '{"mode":"global","global_threshold":' || CAST(threshold AS TEXT) ||
    ',"category_thresholds":{},"max_tags":null}';
"""

LOCAL_TAGGER_DOWNLOADS_MIGRATION = """
CREATE TABLE local_tagger_hf_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    proxy_mode TEXT NOT NULL
        CHECK (proxy_mode IN ('environment', 'custom', 'direct')),
    updated_at TEXT NOT NULL
);

CREATE TABLE local_tagger_downloads (
    id TEXT PRIMARY KEY,
    plan_id TEXT NOT NULL,
    plan_snapshot_json TEXT NOT NULL,
    adapter_id TEXT NOT NULL,
    repo_id TEXT NOT NULL,
    revision TEXT NOT NULL CHECK (length(revision) = 40),
    model_root TEXT NOT NULL,
    status TEXT NOT NULL CHECK (
        status IN (
            'queued', 'resolving', 'downloading', 'verifying', 'installing',
            'completed', 'paused', 'failed', 'interrupted'
        )
    ),
    bytes_total INTEGER NOT NULL CHECK (bytes_total > 0),
    bytes_downloaded INTEGER NOT NULL DEFAULT 0 CHECK (bytes_downloaded >= 0),
    files_total INTEGER NOT NULL CHECK (files_total > 0),
    files_completed INTEGER NOT NULL DEFAULT 0 CHECK (files_completed >= 0),
    current_file TEXT,
    speed_bps REAL CHECK (speed_bps IS NULL OR speed_bps >= 0),
    stop_requested INTEGER NOT NULL DEFAULT 0 CHECK (stop_requested IN (0, 1)),
    worker_id TEXT,
    installation_id TEXT,
    error_code TEXT,
    error_message TEXT,
    created_at TEXT NOT NULL,
    started_at TEXT,
    completed_at TEXT,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (installation_id)
        REFERENCES local_tagger_installations(id) ON DELETE SET NULL
);

CREATE INDEX idx_local_tagger_downloads_created
ON local_tagger_downloads(created_at DESC);

CREATE UNIQUE INDEX idx_local_tagger_downloads_active_plan
ON local_tagger_downloads(plan_id)
WHERE status IN ('queued', 'resolving', 'downloading', 'verifying', 'installing');
"""

PLATFORM_PATH_IDENTITY_MIGRATION = """
DROP INDEX IF EXISTS idx_recent_workspaces_visible_root;

ALTER TABLE recent_workspaces
ADD COLUMN root_path_key TEXT;

CREATE TRIGGER recent_workspaces_require_root_path_key_insert
BEFORE INSERT ON recent_workspaces
WHEN NEW.root_path_key IS NULL OR NEW.root_path_key = ''
BEGIN
    SELECT RAISE(ABORT, 'recent workspace root_path_key is required');
END;

CREATE TRIGGER recent_workspaces_require_root_path_key_update
BEFORE UPDATE OF root_path_key ON recent_workspaces
WHEN NEW.root_path_key IS NULL OR NEW.root_path_key = ''
BEGIN
    SELECT RAISE(ABORT, 'recent workspace root_path_key is required');
END;
"""

LOCAL_TAG_DICTIONARIES_MIGRATION = """
CREATE TABLE local_tag_dictionary_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    dictionary_root TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE local_tag_dictionary_installations (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    adapter_id TEXT NOT NULL,
    source_id TEXT NOT NULL,
    source_version TEXT NOT NULL,
    language TEXT NOT NULL,
    relative_path TEXT NOT NULL COLLATE NOCASE UNIQUE,
    fingerprint TEXT NOT NULL CHECK (length(fingerprint) = 64),
    entry_count INTEGER NOT NULL CHECK (entry_count > 0),
    enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
    priority INTEGER NOT NULL CHECK (priority >= 0),
    manifest_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX idx_local_tag_dictionary_installations_order
ON local_tag_dictionary_installations(enabled DESC, priority, created_at);

CREATE TABLE local_tag_dictionary_overrides (
    normalized_tag TEXT NOT NULL,
    tag TEXT NOT NULL,
    language TEXT NOT NULL,
    translation TEXT NOT NULL,
    category TEXT,
    revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY(normalized_tag, language)
);

CREATE INDEX idx_local_tag_dictionary_overrides_updated
ON local_tag_dictionary_overrides(updated_at DESC);

CREATE TABLE local_tag_dictionary_downloads (
    id TEXT PRIMARY KEY,
    offer_id TEXT NOT NULL,
    offer_snapshot_json TEXT NOT NULL,
    dictionary_root TEXT NOT NULL,
    status TEXT NOT NULL CHECK (
        status IN (
            'queued', 'downloading', 'verifying', 'installing',
            'completed', 'paused', 'failed', 'interrupted'
        )
    ),
    bytes_total INTEGER NOT NULL CHECK (bytes_total > 0),
    bytes_downloaded INTEGER NOT NULL DEFAULT 0 CHECK (bytes_downloaded >= 0),
    current_file TEXT,
    speed_bps REAL CHECK (speed_bps IS NULL OR speed_bps >= 0),
    stop_requested INTEGER NOT NULL DEFAULT 0 CHECK (stop_requested IN (0, 1)),
    worker_id TEXT,
    installation_id TEXT,
    license_notice_hash TEXT NOT NULL CHECK (length(license_notice_hash) = 64),
    license_accepted_at TEXT NOT NULL,
    error_code TEXT,
    error_message TEXT,
    created_at TEXT NOT NULL,
    started_at TEXT,
    completed_at TEXT,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (installation_id)
        REFERENCES local_tag_dictionary_installations(id) ON DELETE SET NULL
);

CREATE INDEX idx_local_tag_dictionary_downloads_created
ON local_tag_dictionary_downloads(created_at DESC);

CREATE UNIQUE INDEX idx_local_tag_dictionary_downloads_active_offer
ON local_tag_dictionary_downloads(offer_id)
WHERE status IN ('queued', 'downloading', 'verifying', 'installing');
"""

SCREENING_WORKER_ACTIVITY_MIGRATION = """
CREATE TABLE worker_workspace_activity_v016 (
    project_id TEXT PRIMARY KEY,
    jobs_requested_at TEXT,
    exports_requested_at TEXT,
    screening_requested_at TEXT,
    FOREIGN KEY (project_id)
        REFERENCES recent_workspaces(project_id) ON DELETE CASCADE,
    CHECK (
        jobs_requested_at IS NOT NULL
        OR exports_requested_at IS NOT NULL
        OR screening_requested_at IS NOT NULL
    )
);

INSERT INTO worker_workspace_activity_v016 (
    project_id, jobs_requested_at, exports_requested_at, screening_requested_at
)
SELECT project_id, jobs_requested_at, exports_requested_at, NULL
FROM worker_workspace_activity;

DROP TABLE worker_workspace_activity;
ALTER TABLE worker_workspace_activity_v016 RENAME TO worker_workspace_activity;
"""

CHARACTER_AUDIT_ACTIVITY_MIGRATION = """
CREATE TABLE worker_workspace_activity_v017 (
    project_id TEXT PRIMARY KEY,
    jobs_requested_at TEXT,
    exports_requested_at TEXT,
    screening_requested_at TEXT,
    character_audits_requested_at TEXT,
    FOREIGN KEY (project_id) REFERENCES recent_workspaces(project_id) ON DELETE CASCADE,
    CHECK (jobs_requested_at IS NOT NULL OR exports_requested_at IS NOT NULL
        OR screening_requested_at IS NOT NULL OR character_audits_requested_at IS NOT NULL)
);
INSERT INTO worker_workspace_activity_v017
SELECT project_id, jobs_requested_at, exports_requested_at, screening_requested_at, NULL
FROM worker_workspace_activity;
DROP TABLE worker_workspace_activity;
ALTER TABLE worker_workspace_activity_v017 RENAME TO worker_workspace_activity;
"""

GLOBAL_SCHEMA_VERSION = 17
