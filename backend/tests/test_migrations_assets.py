from pathlib import Path

from dataset_studio.core.migrations import migrate_database
from dataset_studio.core.sqlite import connect
from dataset_studio.modules.workspaces.schema import (
    WORKSPACE_MIGRATIONS,
    WORKSPACE_SCHEMA_VERSION,
    initialize_workspace_database,
)


def test_screening_task_profile_migration_preserves_existing_results(tmp_path: Path) -> None:
    database = tmp_path / "workspace.sqlite3"
    migrate_database(database, WORKSPACE_MIGRATIONS[:18])
    now = "2026-08-13T00:00:00Z"
    connection = connect(database)
    try:
        connection.execute(
            """
            INSERT INTO assets (
                id, relative_path, filename, stem, suffix, content_hash,
                byte_size, modified_ns, width, height, annotation_relative_path,
                annotation_status, image_metadata_version, created_at, updated_at
            ) VALUES (
                'asset', 'sample.png', 'sample.png', 'sample', '.png', 'hash',
                1, 1, 32, 32, 'sample.txt', 'missing', 1, ?, ?
            )
            """,
            (now, now),
        )
        connection.execute(
            """
            INSERT INTO screening_operations (
                id, status, score_mode, score_version, total_items,
                processed_items, scored_items, configuration_snapshot,
                created_at, updated_at, completed_at
            ) VALUES (
                'operation', 'completed', 'batch_only_v0_1',
                'metarank-batch-v0.1', 1, 1, 1, '{}', ?, ?, ?
            )
            """,
            (now, now, now),
        )
        connection.execute(
            """
            INSERT INTO screening_items (
                id, operation_id, position, asset_id, source_relative_path,
                image_hash, image_size, image_modified_ns, image_width,
                image_height, status, rating, final_score, candidate_pool,
                created_at, updated_at
            ) VALUES (
                'item', 'operation', 0, 'asset', 'sample.png', 'hash', 1, 1,
                32, 32, 'scored', 'g', 0.9, 'elite_candidate', ?, ?
            )
            """,
            (now, now),
        )
        connection.commit()
    finally:
        connection.close()

    initialize_workspace_database(database)

    connection = connect(database)
    try:
        operation = connection.execute(
            """
            SELECT task_profile_snapshot, task_evaluated_items
            FROM screening_operations WHERE id = 'operation'
            """
        ).fetchone()
        item = connection.execute(
            """
            SELECT candidate_pool, quality_candidate_pool, task_fit_score
            FROM screening_items WHERE id = 'item'
            """
        ).fetchone()
    finally:
        connection.close()

    assert operation["task_profile_snapshot"] is None
    assert operation["task_evaluated_items"] == 0
    assert item["candidate_pool"] == "elite_candidate"
    assert item["quality_candidate_pool"] == "elite_candidate"
    assert item["task_fit_score"] is None


def test_candidate_migration_preserves_assets_and_adds_empty_membership(tmp_path: Path) -> None:
    database = tmp_path / "workspace.sqlite3"
    migrate_database(database, WORKSPACE_MIGRATIONS[:19])
    now = "2026-08-14T00:00:00Z"
    connection = connect(database)
    try:
        connection.execute(
            """
            INSERT INTO assets (
                id, relative_path, filename, stem, suffix, content_hash,
                byte_size, modified_ns, width, height, annotation_relative_path,
                annotation_status, image_metadata_version, created_at, updated_at
            ) VALUES (
                'asset', 'sample.png', 'sample.png', 'sample', '.png', 'hash',
                1, 1, 32, 32, 'sample.txt', 'missing', 1, ?, ?
            )
            """,
            (now, now),
        )
        connection.commit()
    finally:
        connection.close()

    migrate_database(database, WORKSPACE_MIGRATIONS)

    connection = connect(database)
    try:
        asset_count = connection.execute("SELECT COUNT(*) FROM assets").fetchone()[0]
        candidate_count = connection.execute("SELECT COUNT(*) FROM asset_candidates").fetchone()[0]
        foreign_keys = connection.execute("PRAGMA foreign_key_list('asset_candidates')").fetchall()
    finally:
        connection.close()
    assert asset_count == 1
    assert candidate_count == 0
    assert [(row["table"], row["from"], row["to"], row["on_delete"]) for row in foreign_keys] == [
        ("assets", "asset_id", "id", "CASCADE")
    ]


def test_asset_source_identity_migration_backfills_valid_screening_snapshots(
    tmp_path: Path,
) -> None:
    database = tmp_path / "workspace.sqlite3"
    migrate_database(database, WORKSPACE_MIGRATIONS[:20])
    now = "2026-08-14T00:00:00Z"
    connection = connect(database)
    try:
        for asset_id, relative_path in (
            ("asset-valid", "Columbina/11956520.png"),
            ("asset-malformed", "Sandrone/broken.png"),
        ):
            connection.execute(
                """
                INSERT INTO assets (
                    id, relative_path, filename, stem, suffix, content_hash,
                    byte_size, modified_ns, width, height, annotation_relative_path,
                    annotation_status, image_metadata_version, created_at, updated_at
                ) VALUES (?, ?, ?, ?, '.png', ?, 1, 1, 32, 32, ?, 'missing', 1, ?, ?)
                """,
                (
                    asset_id,
                    relative_path,
                    Path(relative_path).name,
                    Path(relative_path).stem,
                    f"hash-{asset_id}",
                    str(Path(relative_path).with_suffix(".txt")).replace("\\", "/"),
                    now,
                    now,
                ),
            )
        connection.execute(
            """
            INSERT INTO screening_operations (
                id, status, score_mode, score_version, total_items,
                processed_items, scored_items, configuration_snapshot,
                created_at, updated_at, completed_at
            ) VALUES (
                'operation', 'completed', 'batch_only_v0_1',
                'metarank-batch-v0.1', 2, 2, 1, '{}', ?, ?, ?
            )
            """,
            (now, now, now),
        )
        for position, (item_id, asset_id, relative_path, snapshot) in enumerate(
            (
                (
                    "item-valid",
                    "asset-valid",
                    "Columbina/11956520.png",
                    '{"post_id":"11956520"}',
                ),
                ("item-malformed", "asset-malformed", "Sandrone/broken.png", "{broken"),
            )
        ):
            connection.execute(
                """
                INSERT INTO screening_items (
                    id, operation_id, position, asset_id, source_relative_path,
                    image_hash, image_size, image_modified_ns, image_width,
                    image_height, status, normalized_snapshot, created_at, updated_at
                ) VALUES (?, 'operation', ?, ?, ?, ?, 1, 1, 32, 32, 'scored', ?, ?, ?)
                """,
                (
                    item_id,
                    position,
                    asset_id,
                    relative_path,
                    f"hash-{asset_id}",
                    snapshot,
                    now,
                    now,
                ),
            )
        connection.commit()
    finally:
        connection.close()

    migrate_database(database, WORKSPACE_MIGRATIONS)

    connection = connect(database)
    try:
        identities = connection.execute(
            """
            SELECT asset_id, source_kind, source_id, source_operation_id
            FROM asset_source_identities ORDER BY asset_id
            """
        ).fetchall()
        indexes = {
            str(row["name"])
            for row in connection.execute(
                "SELECT name FROM sqlite_master WHERE type = 'index'"
            ).fetchall()
        }
    finally:
        connection.close()

    assert [tuple(row) for row in identities] == [
        ("asset-valid", "danbooru", "11956520", "operation")
    ]
    assert "idx_asset_source_identities_lookup" in indexes


def test_workspace_database_migrates_existing_asset_metadata_version(tmp_path: Path) -> None:
    database = tmp_path / "workspace.sqlite3"
    migrate_database(database, (WORKSPACE_MIGRATIONS[0],))
    connection = connect(database)
    try:
        connection.execute(
            """
            INSERT INTO assets (
                id, relative_path, filename, stem, suffix, content_hash,
                byte_size, modified_ns, width, height, annotation_relative_path,
                annotation_status, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                "asset",
                "image.png",
                "image.png",
                "image",
                ".png",
                "hash",
                1,
                1,
                120,
                60,
                "image.txt",
                "missing",
                "2026-01-01T00:00:00Z",
                "2026-01-01T00:00:00Z",
            ),
        )
        connection.commit()
    finally:
        connection.close()

    initialize_workspace_database(database)

    connection = connect(database)
    try:
        row = connection.execute(
            "SELECT image_metadata_version FROM assets WHERE id = 'asset'"
        ).fetchone()
        versions = [
            entry["version"]
            for entry in connection.execute(
                "SELECT version FROM schema_migrations ORDER BY version"
            ).fetchall()
        ]
        indexes = {
            entry["name"]
            for entry in connection.execute("PRAGMA index_list('job_items')").fetchall()
        }
        attempt_columns = {
            entry["name"]: entry
            for entry in connection.execute("PRAGMA table_info('job_attempts')").fetchall()
        }
        preprocess_item_columns = {
            entry["name"]: entry
            for entry in connection.execute("PRAGMA table_info('preprocess_items')").fetchall()
        }
        job_columns = {
            entry["name"]: entry
            for entry in connection.execute("PRAGMA table_info('jobs')").fetchall()
        }
        job_item_columns = {
            entry["name"]: entry
            for entry in connection.execute("PRAGMA table_info('job_items')").fetchall()
        }
        export_operation_columns = {
            entry["name"]: entry
            for entry in connection.execute("PRAGMA table_info('export_operations')").fetchall()
        }
        export_item_columns = {
            entry["name"]: entry
            for entry in connection.execute("PRAGMA table_info('export_items')").fetchall()
        }
        output_lease_columns = {
            entry["name"]: entry
            for entry in connection.execute(
                "PRAGMA table_info('output_resource_leases')"
            ).fetchall()
        }
        tables = {
            entry["name"]
            for entry in connection.execute(
                "SELECT name FROM sqlite_master WHERE type = 'table'"
            ).fetchall()
        }
        foreign_key_violations = connection.execute("PRAGMA foreign_key_check").fetchall()
    finally:
        connection.close()
    assert row["image_metadata_version"] == 1
    assert versions == list(range(1, WORKSPACE_SCHEMA_VERSION + 1))
    assert "idx_job_items_asset_updated" in indexes
    assert {
        "cache_read_tokens",
        "cache_write_tokens",
        "reasoning_tokens",
    }.issubset(attempt_columns)
    assert attempt_columns["cache_read_tokens"]["notnull"] == 0
    assert "source_annotation_hash" in attempt_columns
    assert {
        "export_operations",
        "export_items",
        "asset_delete_operations",
        "asset_delete_items",
        "asset_delete_files",
        "output_resource_leases",
        "annotation_store_state",
        "annotation_documents",
        "annotation_document_revisions",
        "annotation_text_contents",
        "annotation_tag_items",
        "annotation_revision_inputs",
        "job_item_annotation_inputs",
        "legacy_annotation_imports",
        "asset_candidates",
        "asset_source_identities",
    }.issubset(tables)
    assert preprocess_item_columns["phase"]["notnull"] == 1
    assert preprocess_item_columns["phase"]["dflt_value"] == "'committed'"
    assert {
        "planned_route",
        "actual_route",
        "backend_id",
        "decode_location",
        "resize_location",
        "encode_location",
        "route_reason_code",
        "fallback_code",
        "render_duration_ms",
    }.issubset(preprocess_item_columns)
    assert {
        "execution_backend",
        "execution_profile_id",
        "execution_snapshot",
        "output_channel",
        "use_tags_as_context",
    }.issubset(job_columns)
    assert "output_base_revision_id" in job_item_columns
    assert "configuration_snapshot" in export_operation_columns
    assert "artifact_snapshot" in export_item_columns
    assert {"job_item_id", "operation_id", "acquired_at"}.issubset(output_lease_columns)
    assert output_lease_columns["job_item_id"]["notnull"] == 0
    assert foreign_key_violations == []
