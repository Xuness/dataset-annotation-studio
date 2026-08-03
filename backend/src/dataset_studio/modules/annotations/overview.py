from __future__ import annotations

import sqlite3
from pathlib import Path

from dataset_studio.core.sqlite import connect
from dataset_studio.modules.annotations.models import (
    AnnotationChannel,
    AnnotationChannelOverview,
    AnnotationOverview,
    AnnotationTranslationVariantOverview,
)
from dataset_studio.modules.annotations.projection import (
    INVALID_VALIDATION_VALUES,
    current_usable_source_revision_sql,
    translation_dependency_revision_sql,
)
from dataset_studio.modules.translations.identity import (
    TranslationProducerKind,
    TranslationSourceKind,
)

_CHANNEL_ORDER = (
    AnnotationChannel.EXISTING,
    AnnotationChannel.TAGS,
    AnnotationChannel.DESCRIPTION,
    AnnotationChannel.TRANSLATION,
)


def _overview_rows(connection: sqlite3.Connection) -> list[sqlite3.Row]:
    invalid_values = ", ".join(f"'{value}'" for value in INVALID_VALIDATION_VALUES)
    dependency_revision = translation_dependency_revision_sql(revision_alias="r")
    current_source_revision = current_usable_source_revision_sql(
        asset_alias="a",
        source_kind_sql="d.translation_source_kind",
    )
    return connection.execute(
        f"""
        WITH raw_documents AS (
            SELECT
                d.asset_id,
                d.channel,
                d.language,
                d.translation_source_kind,
                d.translation_producer_kind,
                d.display_name,
                r.id AS revision_id,
                r.is_tombstone,
                r.image_content_hash,
                r.validation_status,
                a.content_hash AS current_image_hash,
                CASE
                    WHEN d.channel = 'translation'
                    THEN ({dependency_revision})
                    ELSE NULL
                END AS dependency_revision_id,
                CASE
                    WHEN d.channel = 'translation'
                    THEN ({current_source_revision})
                    ELSE NULL
                END AS current_source_revision_id
            FROM annotation_documents d
            JOIN assets a ON a.id = d.asset_id AND a.is_present = 1
            LEFT JOIN annotation_document_revisions r ON r.id = d.head_revision_id
        ),
        projected_documents AS (
            SELECT
                asset_id,
                channel,
                language,
                translation_source_kind,
                translation_producer_kind,
                display_name,
                CASE
                    WHEN revision_id IS NULL OR is_tombstone != 0 THEN NULL
                    WHEN (
                        (
                            image_content_hash IS NOT NULL
                            AND current_image_hash IS NOT NULL
                            AND image_content_hash != current_image_hash
                        )
                        OR (
                            channel = 'translation'
                            AND (
                                current_source_revision_id IS NULL
                                OR dependency_revision_id IS NULL
                                OR dependency_revision_id != current_source_revision_id
                            )
                        )
                    ) THEN 'stale'
                    WHEN validation_status IN ({invalid_values}) THEN 'invalid'
                    ELSE 'usable'
                END AS availability
            FROM raw_documents
        ),
        active_documents AS (
            SELECT *
            FROM projected_documents
            WHERE availability IS NOT NULL
        ),
        channel_asset_states AS (
            SELECT
                channel,
                asset_id,
                COUNT(*) AS active_document_count,
                MAX(
                    CASE availability
                        WHEN 'usable' THEN 3
                        WHEN 'stale' THEN 2
                        ELSE 1
                    END
                ) AS availability_rank
            FROM active_documents
            GROUP BY channel, asset_id
        ),
        channel_summaries AS (
            SELECT
                channel,
                SUM(active_document_count) AS active_document_count,
                COUNT(*) AS present_asset_count,
                SUM(CASE WHEN availability_rank = 3 THEN 1 ELSE 0 END)
                    AS usable_asset_count,
                SUM(CASE WHEN availability_rank = 2 THEN 1 ELSE 0 END)
                    AS stale_asset_count,
                SUM(CASE WHEN availability_rank = 1 THEN 1 ELSE 0 END)
                    AS invalid_asset_count
            FROM channel_asset_states
            GROUP BY channel
        ),
        translation_variant_summaries AS (
            SELECT
                language,
                translation_source_kind,
                translation_producer_kind,
                MIN(display_name) AS display_name,
                COUNT(*) AS active_document_count,
                COUNT(DISTINCT asset_id) AS present_asset_count,
                COUNT(DISTINCT CASE WHEN availability = 'usable' THEN asset_id END)
                    AS usable_asset_count,
                COUNT(DISTINCT CASE WHEN availability = 'stale' THEN asset_id END)
                    AS stale_asset_count,
                COUNT(DISTINCT CASE WHEN availability = 'invalid' THEN asset_id END)
                    AS invalid_asset_count
            FROM active_documents
            WHERE channel = 'translation'
            GROUP BY language, translation_source_kind, translation_producer_kind
        )
        SELECT
            'channel' AS row_kind,
            channel,
            '' AS language,
            '' AS translation_source_kind,
            '' AS translation_producer_kind,
            '' AS display_name,
            active_document_count,
            present_asset_count,
            usable_asset_count,
            stale_asset_count,
            invalid_asset_count
        FROM channel_summaries

        UNION ALL

        SELECT
            'translation_variant' AS row_kind,
            'translation' AS channel,
            language,
            translation_source_kind,
            translation_producer_kind,
            display_name,
            active_document_count,
            present_asset_count,
            usable_asset_count,
            stale_asset_count,
            invalid_asset_count
        FROM translation_variant_summaries

        ORDER BY row_kind, channel, language, translation_source_kind,
                 translation_producer_kind
        """
    ).fetchall()


def _coverage(row: sqlite3.Row | None, asset_count: int) -> dict[str, int]:
    if row is None:
        return {
            "active_document_count": 0,
            "present_asset_count": 0,
            "usable_asset_count": 0,
            "stale_asset_count": 0,
            "invalid_asset_count": 0,
            "missing_asset_count": asset_count,
        }
    present_asset_count = int(row["present_asset_count"])
    return {
        "active_document_count": int(row["active_document_count"]),
        "present_asset_count": present_asset_count,
        "usable_asset_count": int(row["usable_asset_count"]),
        "stale_asset_count": int(row["stale_asset_count"]),
        "invalid_asset_count": int(row["invalid_asset_count"]),
        "missing_asset_count": max(0, asset_count - present_asset_count),
    }


def build_annotation_overview(database_path: Path) -> AnnotationOverview:
    connection = connect(database_path)
    try:
        connection.execute("BEGIN")
        asset_count = int(
            connection.execute("SELECT COUNT(*) FROM assets WHERE is_present = 1").fetchone()[0]
        )
        overview_rows = _overview_rows(connection)
        channel_rows = {
            AnnotationChannel(str(row["channel"])): row
            for row in overview_rows
            if row["row_kind"] == "channel"
        }
        variant_rows = [row for row in overview_rows if row["row_kind"] == "translation_variant"]
    finally:
        connection.close()

    channels = [
        AnnotationChannelOverview(
            channel=channel,
            **_coverage(channel_rows.get(channel), asset_count),
        )
        for channel in _CHANNEL_ORDER
    ]
    translation_variants = [
        AnnotationTranslationVariantOverview(
            language=str(row["language"]),
            translation_source_kind=TranslationSourceKind(str(row["translation_source_kind"])),
            translation_producer_kind=TranslationProducerKind(
                str(row["translation_producer_kind"])
            ),
            display_name=str(row["display_name"]),
            **_coverage(row, asset_count),
        )
        for row in variant_rows
    ]
    return AnnotationOverview(
        asset_count=asset_count,
        channels=channels,
        translation_variants=translation_variants,
    )
