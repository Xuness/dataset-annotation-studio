from dataset_studio.core.migrations import Migration

SQL = """
UPDATE preprocess_items
SET recovery_relative_path = substr(recovery_relative_path, 23)
WHERE recovery_relative_path LIKE '.annotation-workspace/%';
UPDATE asset_delete_files
SET recovery_relative_path = substr(recovery_relative_path, 23)
WHERE recovery_relative_path LIKE '.annotation-workspace/%';
UPDATE job_attempts
SET provider_payload_path = substr(provider_payload_path, 23)
WHERE provider_payload_path LIKE '.annotation-workspace/%';
UPDATE annotation_store_state
SET backup_relative_path = substr(backup_relative_path, 23)
WHERE backup_relative_path LIKE '.annotation-workspace/%';
CREATE TABLE export_file_journal (
    operation_id TEXT NOT NULL,
    target_relative_path TEXT NOT NULL,
    phase TEXT NOT NULL,
    backup_relative_path TEXT,
    PRIMARY KEY(operation_id, target_relative_path)
);
CREATE TABLE original_files (
    id TEXT PRIMARY KEY,
    asset_id TEXT NOT NULL,
    role TEXT NOT NULL,
    source_relative_path TEXT NOT NULL,
    backup_relative_path TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    byte_size INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE(asset_id, role)
);
CREATE TABLE companion_files (
    asset_id TEXT NOT NULL,
    role TEXT NOT NULL,
    relative_path TEXT NOT NULL UNIQUE,
    PRIMARY KEY(asset_id, role)
);
CREATE TABLE file_restore_operations (
    id TEXT PRIMARY KEY,
    status TEXT NOT NULL,
    plan_json TEXT NOT NULL,
    completed_json TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL,
    error_message TEXT
);
"""

MIGRATION = Migration(version=22, name="external_workspace", sql=SQL)
