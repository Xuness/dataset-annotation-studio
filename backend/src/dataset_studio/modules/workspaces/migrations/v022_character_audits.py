from dataset_studio.core.migrations import Migration

SQL = """
CREATE TABLE character_audits (
    id TEXT PRIMARY KEY,
    status TEXT NOT NULL CHECK (status IN (
        'draft', 'preparing', 'queued', 'running', 'stopping', 'stopped',
        'interrupted', 'failed', 'review', 'applied'
    )),
    version INTEGER NOT NULL CHECK (version >= 1),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    state_json TEXT NOT NULL
);
CREATE INDEX idx_character_audits_status ON character_audits(status, created_at);
"""

MIGRATION = Migration(22, "character_audits", SQL)
