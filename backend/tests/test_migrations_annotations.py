import sqlite3
from pathlib import Path

import pytest

from dataset_studio.core.migrations import migrate_database
from dataset_studio.core.sqlite import connect
from dataset_studio.core.time import utc_now_iso
from dataset_studio.modules.annotations.models import AnnotationChannel, AnnotationStatus
from dataset_studio.modules.annotations.repository import AnnotationRepository
from dataset_studio.modules.workspaces.schema import (
    WORKSPACE_MIGRATIONS,
    initialize_workspace_database,
)


def test_annotation_store_migration_backfills_existing_job_output_channels(
    tmp_path: Path,
) -> None:
    database = tmp_path / "workspace.sqlite3"
    migrate_database(database, WORKSPACE_MIGRATIONS[:10])
    connection = connect(database)
    try:
        common = {
            "status": "queued",
            "system_preset_id": "preset",
            "system_prompt_snapshot": "{}",
            "provider_profile_id": "provider",
            "provider_snapshot": "{}",
            "user_prompt_snapshot": "",
            "json_fields_snapshot": "[]",
            "scope": "all",
            "created_at": "2026-01-01T00:00:00Z",
            "updated_at": "2026-01-01T00:00:00Z",
        }
        connection.executemany(
            """
            INSERT INTO jobs (
                id, status, system_preset_id, system_prompt_snapshot,
                provider_profile_id, provider_snapshot, user_prompt_snapshot,
                json_fields_snapshot, scope, created_at, updated_at,
                kind, configuration_snapshot, execution_backend,
                execution_profile_id, execution_snapshot
            ) VALUES (
                :id, :status, :system_preset_id, :system_prompt_snapshot,
                :provider_profile_id, :provider_snapshot, :user_prompt_snapshot,
                :json_fields_snapshot, :scope, :created_at, :updated_at,
                :kind, :configuration_snapshot, :execution_backend,
                :execution_profile_id, :execution_snapshot
            )
            """,
            [
                {
                    **common,
                    "id": "provider-annotation",
                    "kind": "annotation",
                    "configuration_snapshot": "{}",
                    "execution_backend": "provider",
                    "execution_profile_id": "provider:model",
                    "execution_snapshot": "{}",
                },
                {
                    **common,
                    "id": "provider-translation",
                    "kind": "translation",
                    "configuration_snapshot": '{"target_language":"zh-CN"}',
                    "execution_backend": "provider",
                    "execution_profile_id": "provider:model",
                    "execution_snapshot": "{}",
                },
                {
                    **common,
                    "id": "local-tagger",
                    "kind": "annotation",
                    "configuration_snapshot": "{}",
                    "execution_backend": "local_tagger",
                    "execution_profile_id": "tagger-profile",
                    "execution_snapshot": "{}",
                },
            ],
        )
        connection.commit()
    finally:
        connection.close()

    migrate_database(database, WORKSPACE_MIGRATIONS[:11])
    connection = connect(database)
    try:
        connection.execute(
            "UPDATE jobs SET use_confirmed_tags = 1 WHERE id = 'provider-annotation'"
        )
        connection.commit()
    finally:
        connection.close()

    initialize_workspace_database(database)

    connection = connect(database)
    try:
        jobs = {
            str(row["id"]): (
                str(row["output_channel"]),
                bool(row["use_tags_as_context"]),
            )
            for row in connection.execute(
                "SELECT id, output_channel, use_tags_as_context FROM jobs ORDER BY id"
            ).fetchall()
        }
    finally:
        connection.close()

    assert jobs == {
        "local-tagger": ("tags", False),
        "provider-annotation": ("description", True),
        "provider-translation": ("translation", False),
    }


def test_review_decoupling_migration_clears_automatic_confirmation_markers(
    tmp_path: Path,
) -> None:
    database = tmp_path / "workspace.sqlite3"
    migrate_database(database, WORKSPACE_MIGRATIONS[:11])
    connection = connect(database)
    try:
        connection.execute(
            """
            INSERT INTO assets (
                id, relative_path, filename, stem, suffix, content_hash,
                byte_size, modified_ns, width, height, annotation_relative_path,
                annotation_status, created_at, updated_at
            ) VALUES (
                'asset', 'sample.png', 'sample.png', 'sample', '.png', 'image-hash',
                1, 1, 32, 32, 'sample.txt',
                'valid', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'
            )
            """
        )
        documents = (
            ("description", "text", "model_response"),
            ("tags", "tags", "local_tagger"),
            ("existing_annotation", "text", "legacy_txt_import"),
        )
        for channel, content_kind, source in documents:
            document_id = f"document-{channel}"
            revision_id = f"revision-{channel}"
            connection.execute(
                """
                INSERT INTO annotation_documents (
                    id, asset_id, channel, language, display_name, content_kind,
                    created_at, updated_at
                ) VALUES (?, 'asset', ?, '', ?, ?, ?, ?)
                """,
                (
                    document_id,
                    channel,
                    channel,
                    content_kind,
                    "2026-01-01T00:00:00Z",
                    "2026-01-01T00:00:00Z",
                ),
            )
            connection.execute(
                """
                INSERT INTO annotation_document_revisions (
                    id, document_id, source, image_content_hash,
                    validation_status, created_at
                ) VALUES (?, ?, ?, 'image-hash', 'valid', ?)
                """,
                (
                    revision_id,
                    document_id,
                    source,
                    "2026-01-01T00:00:00Z",
                ),
            )
            connection.execute(
                """
                UPDATE annotation_documents
                SET head_revision_id = ?, confirmed_revision_id = ?
                WHERE id = ?
                """,
                (revision_id, revision_id, document_id),
            )
        connection.commit()
    finally:
        connection.close()

    initialize_workspace_database(database)

    connection = connect(database)
    try:
        rows = {
            str(row["channel"]): row
            for row in connection.execute(
                """
                SELECT channel, head_revision_id, reviewed_revision_id
                FROM annotation_documents
                """
            ).fetchall()
        }
        foreign_key_violations = connection.execute("PRAGMA foreign_key_check").fetchall()
    finally:
        connection.close()

    assert rows["description"]["reviewed_revision_id"] == rows["description"]["head_revision_id"]
    assert rows["tags"]["reviewed_revision_id"] is None
    assert rows["existing_annotation"]["reviewed_revision_id"] is None
    assert foreign_key_violations == []


def test_translation_variant_migration_preserves_history_and_allows_parallel_variants(
    tmp_path: Path,
) -> None:
    database = tmp_path / "workspace.sqlite3"
    migrate_database(database, WORKSPACE_MIGRATIONS[:15])
    now = "2026-07-25T00:00:00Z"
    connection = connect(database)
    try:
        connection.execute(
            """
            INSERT INTO assets (
                id, relative_path, filename, stem, suffix, content_hash,
                byte_size, modified_ns, width, height, annotation_relative_path,
                annotation_status, image_metadata_version, created_at, updated_at
            ) VALUES (
                'asset', 'sample.png', 'sample.png', 'sample', '.png', 'image-hash',
                1, 1, 32, 32, 'sample.txt', 'missing', 1, ?, ?
            )
            """,
            (now, now),
        )
        connection.execute(
            """
            INSERT INTO annotation_documents (
                id, asset_id, channel, language, display_name, content_kind,
                created_at, updated_at
            ) VALUES (
                'legacy-translation', 'asset', 'translation', 'zh-CN',
                '翻译 · zh-CN', 'text', ?, ?
            )
            """,
            (now, now),
        )
        connection.execute(
            """
            INSERT INTO annotation_document_revisions (
                id, document_id, source, image_content_hash,
                validation_status, created_at
            ) VALUES (
                'legacy-revision', 'legacy-translation', 'model_response',
                'image-hash', 'valid', ?
            )
            """,
            (now,),
        )
        connection.execute(
            """
            INSERT INTO annotation_text_contents (revision_id, content)
            VALUES ('legacy-revision', '<caption>旧译文</caption>')
            """
        )
        connection.execute(
            """
            UPDATE annotation_documents
            SET head_revision_id = 'legacy-revision',
                reviewed_revision_id = 'legacy-revision'
            WHERE id = 'legacy-translation'
            """
        )
        connection.commit()
    finally:
        connection.close()

    initialize_workspace_database(database)

    connection = connect(database)
    try:
        migrated = connection.execute(
            """
            SELECT id, translation_source_kind, translation_producer_kind,
                   head_revision_id, reviewed_revision_id
            FROM annotation_documents
            WHERE id = 'legacy-translation'
            """
        ).fetchone()
        content = connection.execute(
            """
            SELECT content
            FROM annotation_text_contents
            WHERE revision_id = 'legacy-revision'
            """
        ).fetchone()
        revision_document = connection.execute(
            """
            SELECT document_id
            FROM annotation_document_revisions
            WHERE id = 'legacy-revision'
            """
        ).fetchone()
        foreign_key_violations = connection.execute("PRAGMA foreign_key_check").fetchall()
    finally:
        connection.close()

    assert migrated is not None
    assert migrated["translation_source_kind"] == "description"
    assert migrated["translation_producer_kind"] == "llm"
    assert migrated["head_revision_id"] == "legacy-revision"
    assert migrated["reviewed_revision_id"] == "legacy-revision"
    assert content["content"] == "<caption>旧译文</caption>"
    assert revision_document["document_id"] == "legacy-translation"
    assert foreign_key_violations == []

    repository = AnnotationRepository(database)
    repository.write_text(
        asset_id="asset",
        channel=AnnotationChannel.TRANSLATION,
        language="zh-CN",
        translation_source_kind="tags",
        translation_producer_kind="llm",
        content="蓝发",
        source="model_response",
        validation_status=AnnotationStatus.VALID,
        image_content_hash="image-hash",
    )
    repository.write_text(
        asset_id="asset",
        channel=AnnotationChannel.TRANSLATION,
        language="zh-CN",
        translation_source_kind="description",
        translation_producer_kind="local_dictionary",
        content="<caption>词典译文</caption>",
        source="local_dictionary",
        validation_status=AnnotationStatus.VALID,
        image_content_hash="image-hash",
    )

    connection = connect(database)
    try:
        variants = [
            (
                row["translation_source_kind"],
                row["translation_producer_kind"],
                row["language"],
            )
            for row in connection.execute(
                """
                SELECT translation_source_kind, translation_producer_kind, language
                FROM annotation_documents
                WHERE asset_id = 'asset' AND channel = 'translation'
                ORDER BY translation_source_kind, translation_producer_kind
                """
            ).fetchall()
        ]
        foreign_key_violations = connection.execute("PRAGMA foreign_key_check").fetchall()
    finally:
        connection.close()

    assert variants == [
        ("description", "llm", "zh-CN"),
        ("description", "local_dictionary", "zh-CN"),
        ("tags", "llm", "zh-CN"),
    ]
    assert foreign_key_violations == []


def test_annotation_relation_triggers_reject_cross_asset_revisions(tmp_path: Path) -> None:
    database = tmp_path / "workspace.sqlite3"
    initialize_workspace_database(database)
    now = utc_now_iso()
    connection = connect(database)
    try:
        connection.executemany(
            """
            INSERT INTO assets (
                id, relative_path, filename, stem, suffix, content_hash,
                byte_size, modified_ns, width, height, annotation_relative_path,
                annotation_status, image_metadata_version, created_at, updated_at
            ) VALUES (?, ?, ?, ?, '.png', ?, 1, 1, 32, 32, ?, 'missing', 1, ?, ?)
            """,
            [
                ("asset-a", "a.png", "a.png", "a", "hash-a", "a.txt", now, now),
                ("asset-b", "b.png", "b.png", "b", "hash-b", "b.txt", now, now),
            ],
        )
        connection.commit()
    finally:
        connection.close()

    repository = AnnotationRepository(database)
    first = repository.write_text(
        asset_id="asset-a",
        channel=AnnotationChannel.DESCRIPTION,
        content="<caption>a</caption>",
        source="manual_edit",
        validation_status=AnnotationStatus.VALID,
        image_content_hash="hash-a",
    )
    second = repository.write_text(
        asset_id="asset-b",
        channel=AnnotationChannel.DESCRIPTION,
        content="<caption>b</caption>",
        source="manual_edit",
        validation_status=AnnotationStatus.VALID,
        image_content_hash="hash-b",
    )

    connection = connect(database)
    try:
        with pytest.raises(sqlite3.IntegrityError, match="revision scope mismatch"):
            connection.execute(
                """
                UPDATE annotation_documents
                SET head_revision_id = ?
                WHERE id = ?
                """,
                (second.revision_id, first.document_id),
            )
        with pytest.raises(sqlite3.IntegrityError, match="input asset mismatch"):
            connection.execute(
                """
                INSERT INTO annotation_revision_inputs (
                    output_revision_id, input_revision_id, role
                ) VALUES (?, ?, 'invalid-cross-asset')
                """,
                (first.revision_id, second.revision_id),
            )
    finally:
        connection.close()
