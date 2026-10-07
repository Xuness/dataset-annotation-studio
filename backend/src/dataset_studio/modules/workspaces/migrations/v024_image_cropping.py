from dataset_studio.core.migrations import Migration

SQL = """
CREATE TABLE crop_plans (
    id TEXT PRIMARY KEY, token TEXT NOT NULL, request_json TEXT NOT NULL,
    plan_json TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE crop_operations (
    id TEXT PRIMARY KEY, plan_id TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL, total INTEGER NOT NULL, completed INTEGER NOT NULL,
    error TEXT, created_at TEXT NOT NULL,
    FOREIGN KEY(plan_id) REFERENCES crop_plans(id)
);
CREATE TABLE crop_outputs (
    id TEXT PRIMARY KEY, operation_id TEXT NOT NULL, source_id TEXT NOT NULL,
    source_hash TEXT NOT NULL, relative_path TEXT NOT NULL, rectangle_json TEXT NOT NULL,
    output_hash TEXT NOT NULL, phase TEXT NOT NULL,
    file_device TEXT, file_inode TEXT,
    FOREIGN KEY(operation_id) REFERENCES crop_operations(id)
);
CREATE INDEX idx_crop_outputs_source ON crop_outputs(source_id);
CREATE INDEX idx_crop_outputs_operation ON crop_outputs(operation_id);
"""
MIGRATION = Migration(version=24, name="image_cropping", sql=SQL)
