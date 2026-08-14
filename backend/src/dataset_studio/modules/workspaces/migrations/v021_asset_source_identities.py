from __future__ import annotations

from dataset_studio.core.migrations import Migration

SQL = """
CREATE TABLE asset_source_identities (
    asset_id TEXT NOT NULL,
    source_kind TEXT NOT NULL,
    source_id TEXT NOT NULL,
    source_operation_id TEXT,
    observed_at TEXT NOT NULL,
    PRIMARY KEY(asset_id, source_kind),
    CHECK (length(trim(source_kind)) > 0),
    CHECK (length(trim(source_id)) > 0),
    FOREIGN KEY(asset_id) REFERENCES assets(id) ON DELETE CASCADE,
    FOREIGN KEY(source_operation_id) REFERENCES screening_operations(id) ON DELETE SET NULL
);

CREATE INDEX idx_asset_source_identities_lookup
ON asset_source_identities(source_kind, source_id, asset_id);

INSERT OR IGNORE INTO asset_source_identities (
    asset_id, source_kind, source_id, source_operation_id, observed_at
)
SELECT
    asset_id,
    'danbooru',
    trim(CAST(json_extract(
        CASE WHEN json_valid(normalized_snapshot) THEN normalized_snapshot ELSE '{}' END,
        '$.post_id'
    ) AS TEXT)),
    operation_id,
    updated_at
FROM screening_items
WHERE json_type(
    CASE WHEN json_valid(normalized_snapshot) THEN normalized_snapshot ELSE '{}' END,
    '$.post_id'
) IN ('integer', 'text')
AND length(trim(CAST(json_extract(
    CASE WHEN json_valid(normalized_snapshot) THEN normalized_snapshot ELSE '{}' END,
    '$.post_id'
) AS TEXT))) > 0
ORDER BY updated_at DESC;
"""

MIGRATION = Migration(version=21, name="asset_source_identities", sql=SQL)
