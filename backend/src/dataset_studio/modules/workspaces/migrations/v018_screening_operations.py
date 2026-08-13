from __future__ import annotations

from dataset_studio.core.migrations import Migration

SQL = """
CREATE TABLE screening_operations (
    id TEXT PRIMARY KEY,
    status TEXT NOT NULL CHECK (
        status IN (
            'queued', 'running', 'stopping', 'stopped',
            'interrupted', 'completed', 'failed'
        )
    ),
    score_mode TEXT NOT NULL,
    score_version TEXT NOT NULL,
    total_items INTEGER NOT NULL CHECK (total_items > 0),
    processed_items INTEGER NOT NULL DEFAULT 0 CHECK (processed_items >= 0),
    scored_items INTEGER NOT NULL DEFAULT 0 CHECK (scored_items >= 0),
    invalid_items INTEGER NOT NULL DEFAULT 0 CHECK (invalid_items >= 0),
    stop_requested INTEGER NOT NULL DEFAULT 0 CHECK (stop_requested IN (0, 1)),
    current_relative_path TEXT,
    configuration_snapshot TEXT NOT NULL,
    pool_counts_snapshot TEXT NOT NULL DEFAULT '{}',
    rating_counts_snapshot TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    started_at TEXT,
    completed_at TEXT,
    error_message TEXT
);

CREATE UNIQUE INDEX idx_screening_operations_active
ON screening_operations((1))
WHERE status IN ('queued', 'running', 'stopping');

CREATE INDEX idx_screening_operations_created
ON screening_operations(created_at DESC);

CREATE TABLE screening_items (
    id TEXT PRIMARY KEY,
    operation_id TEXT NOT NULL,
    position INTEGER NOT NULL,
    asset_id TEXT NOT NULL,
    source_relative_path TEXT NOT NULL,
    image_hash TEXT NOT NULL,
    image_size INTEGER NOT NULL,
    image_modified_ns INTEGER NOT NULL,
    image_width INTEGER NOT NULL,
    image_height INTEGER NOT NULL,
    metadata_relative_path TEXT,
    metadata_size INTEGER,
    metadata_modified_ns INTEGER,
    metadata_hash TEXT,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (
        status IN ('pending', 'parsed', 'scored', 'invalid')
    ),
    rating TEXT,
    created_at_source TEXT,
    metadata_snapshot_at TEXT,
    age_hours REAL,
    age_bucket TEXT,
    fav_count INTEGER,
    up_score INTEGER,
    downvote_count INTEGER,
    evidence_mass INTEGER,
    confidence_pop REAL,
    confidence_depth REAL,
    confidence_vote REAL,
    technical_score REAL,
    keep_score REAL,
    elite_score REAL,
    final_score REAL,
    rating_rank INTEGER,
    rating_percentile REAL,
    candidate_pool TEXT,
    low_resolution_flag INTEGER NOT NULL DEFAULT 0 CHECK (low_resolution_flag IN (0, 1)),
    pixel_duplicate_group TEXT,
    variant_group TEXT,
    duplicate_representative INTEGER NOT NULL DEFAULT 1
        CHECK (duplicate_representative IN (0, 1)),
    duplicate_of_asset_id TEXT,
    normalized_snapshot TEXT,
    score_details TEXT,
    reason_codes TEXT NOT NULL DEFAULT '[]',
    warnings TEXT NOT NULL DEFAULT '[]',
    error_code TEXT,
    error_message TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY(operation_id) REFERENCES screening_operations(id) ON DELETE CASCADE,
    FOREIGN KEY(asset_id) REFERENCES assets(id),
    UNIQUE(operation_id, asset_id),
    UNIQUE(operation_id, position)
);

CREATE INDEX idx_screening_items_operation_status
ON screening_items(operation_id, status, position);

CREATE INDEX idx_screening_items_operation_pool_rating
ON screening_items(operation_id, candidate_pool, rating, rating_percentile DESC);

CREATE INDEX idx_screening_items_operation_score
ON screening_items(operation_id, rating, final_score DESC);
"""

MIGRATION = Migration(version=18, name="screening_operations", sql=SQL)
