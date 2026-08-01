from __future__ import annotations

import json
import sqlite3
import uuid
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path

from dataset_studio.core.errors import ResourceConflictError
from dataset_studio.core.sqlite import connect, transaction
from dataset_studio.core.time import utc_now_iso
from dataset_studio.modules.annotations.models import (
    AnnotationChannel,
    AnnotationContentKind,
    AnnotationStatus,
    AnnotationTag,
)
from dataset_studio.modules.annotations.projection import (
    INVALID_VALIDATION_STATUSES,
    document_state_projection_sql,
    resolve_document_row_state,
)
from dataset_studio.modules.annotations.review_repository import AnnotationReviewRepository
from dataset_studio.modules.annotations.summary import sync_asset_annotation_summary
from dataset_studio.modules.translations.identity import (
    DEFAULT_TRANSLATION_PRODUCER_KIND,
    DEFAULT_TRANSLATION_SOURCE_KIND,
    TranslationProducerKind,
    TranslationSourceKind,
    translation_identity_values,
)

_EXPECTED_HEAD_UNSET = object()


@dataclass(frozen=True, slots=True)
class RevisionWrite:
    revision_id: str
    document_id: str
    became_head: bool


@dataclass(frozen=True, slots=True)
class TagRevisionWriteRequest:
    asset_id: str
    tags: tuple[AnnotationTag, ...]
    source: str
    validation_status: AnnotationStatus
    image_content_hash: str
    expected_head_revision_id: str | None


def channel_definition(
    channel: AnnotationChannel,
    language: str = "",
    translation_source_kind: TranslationSourceKind | str = DEFAULT_TRANSLATION_SOURCE_KIND,
    translation_producer_kind: TranslationProducerKind | str = DEFAULT_TRANSLATION_PRODUCER_KIND,
) -> tuple[AnnotationContentKind, str]:
    if channel == AnnotationChannel.EXISTING:
        return AnnotationContentKind.TEXT, "原有标注"
    if channel == AnnotationChannel.TAGS:
        return AnnotationContentKind.TAGS, "Tags"
    if channel == AnnotationChannel.DESCRIPTION:
        return AnnotationContentKind.TEXT, "LLM 描述"
    source_kind = TranslationSourceKind(translation_source_kind)
    producer_kind = TranslationProducerKind(translation_producer_kind)
    source_label = "LLM 描述" if source_kind == TranslationSourceKind.DESCRIPTION else "Tags"
    producer_label = "LLM" if producer_kind == TranslationProducerKind.LLM else "本地词典"
    return AnnotationContentKind.TEXT, f"翻译 · {source_label} / {producer_label} · {language}"


class AnnotationRepository:
    def __init__(self, database_path: Path) -> None:
        self._database_path = database_path

    def list_document_rows(self, asset_id: str) -> list[sqlite3.Row]:
        connection = connect(self._database_path)
        try:
            return connection.execute(
                f"""
                SELECT d.*, r.source, r.image_content_hash, r.validation_status,
                       r.is_tombstone, r.is_candidate, r.created_at AS revision_created_at,
                       r.metadata_json, a.content_hash AS current_image_hash,
                       {document_state_projection_sql()}
                FROM annotation_documents d
                JOIN assets a ON a.id = d.asset_id
                LEFT JOIN annotation_document_revisions r ON r.id = d.head_revision_id
                WHERE d.asset_id = ?
                ORDER BY
                    CASE d.channel
                        WHEN 'existing_annotation' THEN 0
                        WHEN 'tags' THEN 1
                        WHEN 'description' THEN 2
                        ELSE 3
                    END,
                    d.translation_source_kind,
                    d.translation_producer_kind,
                    d.language
                """,
                (asset_id,),
            ).fetchall()
        finally:
            connection.close()

    def get_document_row(
        self,
        asset_id: str,
        channel: AnnotationChannel,
        language: str = "",
        translation_source_kind: TranslationSourceKind | str = DEFAULT_TRANSLATION_SOURCE_KIND,
        translation_producer_kind: TranslationProducerKind
        | str = DEFAULT_TRANSLATION_PRODUCER_KIND,
    ) -> sqlite3.Row | None:
        source_value, producer_value = self._identity_values(
            channel,
            translation_source_kind,
            translation_producer_kind,
        )
        connection = connect(self._database_path)
        try:
            return connection.execute(
                f"""
                SELECT d.*, r.source, r.image_content_hash, r.validation_status,
                       r.is_tombstone, r.is_candidate, r.created_at AS revision_created_at,
                       r.metadata_json, a.content_hash AS current_image_hash,
                       {document_state_projection_sql()}
                FROM annotation_documents d
                JOIN assets a ON a.id = d.asset_id
                LEFT JOIN annotation_document_revisions r ON r.id = d.head_revision_id
                WHERE d.asset_id = ? AND d.channel = ? AND d.language = ?
                  AND d.translation_source_kind = ?
                  AND d.translation_producer_kind = ?
                """,
                (asset_id, channel.value, language, source_value, producer_value),
            ).fetchone()
        finally:
            connection.close()

    def get_document_rows(
        self,
        asset_ids: Sequence[str],
        channel: AnnotationChannel,
        language: str = "",
        translation_source_kind: TranslationSourceKind | str = DEFAULT_TRANSLATION_SOURCE_KIND,
        translation_producer_kind: TranslationProducerKind
        | str = DEFAULT_TRANSLATION_PRODUCER_KIND,
    ) -> dict[str, sqlite3.Row]:
        source_value, producer_value = self._identity_values(
            channel,
            translation_source_kind,
            translation_producer_kind,
        )
        unique_ids = list(dict.fromkeys(asset_id for asset_id in asset_ids if asset_id))
        if not unique_ids:
            return {}
        rows: list[sqlite3.Row] = []
        connection = connect(self._database_path)
        try:
            for start in range(0, len(unique_ids), 500):
                batch = unique_ids[start : start + 500]
                placeholders = ",".join("?" for _ in batch)
                rows.extend(
                    connection.execute(
                        f"""
                        SELECT d.*, r.source, r.image_content_hash, r.validation_status,
                               r.is_tombstone, r.is_candidate,
                               r.created_at AS revision_created_at,
                               r.metadata_json, a.content_hash AS current_image_hash,
                               {document_state_projection_sql()}
                        FROM annotation_documents d
                        JOIN assets a ON a.id = d.asset_id
                        LEFT JOIN annotation_document_revisions r
                          ON r.id = d.head_revision_id
                        WHERE d.channel = ? AND d.language = ?
                          AND d.translation_source_kind = ?
                          AND d.translation_producer_kind = ?
                          AND d.asset_id IN ({placeholders})
                        """,
                        [channel.value, language, source_value, producer_value, *batch],
                    ).fetchall()
                )
        finally:
            connection.close()
        return {str(row["asset_id"]): row for row in rows}

    def nearest_local_tagger_snapshot(self, head_revision_id: str) -> str | None:
        connection = connect(self._database_path)
        try:
            row = connection.execute(
                """
                WITH RECURSIVE revision_lineage(
                    id, parent_revision_id, source_job_item_id, is_tombstone, depth
                ) AS (
                    SELECT id, parent_revision_id, source_job_item_id, is_tombstone, 0
                    FROM annotation_document_revisions
                    WHERE id = ?

                    UNION ALL

                    SELECT parent.id, parent.parent_revision_id,
                           parent.source_job_item_id, parent.is_tombstone, child.depth + 1
                    FROM annotation_document_revisions parent
                    JOIN revision_lineage child
                      ON parent.id = child.parent_revision_id
                    WHERE child.depth < 1000 AND child.is_tombstone = 0
                )
                SELECT job.execution_snapshot
                FROM revision_lineage lineage
                JOIN job_items item ON item.id = lineage.source_job_item_id
                JOIN jobs job ON job.id = item.job_id
                WHERE job.execution_backend = 'local_tagger'
                  AND job.execution_snapshot IS NOT NULL
                  AND job.execution_snapshot != ''
                ORDER BY lineage.depth
                LIMIT 1
                """,
                (head_revision_id,),
            ).fetchone()
            return str(row["execution_snapshot"]) if row else None
        finally:
            connection.close()

    def list_document_rows_for_assets(
        self,
        asset_ids: Sequence[str],
    ) -> list[sqlite3.Row]:
        unique_ids = list(dict.fromkeys(asset_id for asset_id in asset_ids if asset_id))
        if not unique_ids:
            return []
        rows: list[sqlite3.Row] = []
        connection = connect(self._database_path)
        try:
            for start in range(0, len(unique_ids), 500):
                batch = unique_ids[start : start + 500]
                placeholders = ",".join("?" for _ in batch)
                rows.extend(
                    connection.execute(
                        f"""
                        SELECT d.*, r.source, r.image_content_hash, r.validation_status,
                               r.is_tombstone, r.is_candidate,
                               r.created_at AS revision_created_at,
                               r.metadata_json, a.content_hash AS current_image_hash,
                               {document_state_projection_sql()}
                        FROM annotation_documents d
                        JOIN assets a ON a.id = d.asset_id
                        LEFT JOIN annotation_document_revisions r
                          ON r.id = d.head_revision_id
                        WHERE d.asset_id IN ({placeholders})
                        ORDER BY
                            CASE d.channel
                                WHEN 'existing_annotation' THEN 0
                                WHEN 'tags' THEN 1
                                WHEN 'description' THEN 2
                                ELSE 3
                        END,
                            d.translation_source_kind,
                            d.translation_producer_kind,
                            d.language,
                            d.asset_id
                        """,
                        batch,
                    ).fetchall()
                )
        finally:
            connection.close()
        return rows

    def text_content(self, revision_id: str) -> tuple[str, bytes | None]:
        connection = connect(self._database_path)
        try:
            row = connection.execute(
                """
                SELECT content, raw_bytes
                FROM annotation_text_contents
                WHERE revision_id = ?
                """,
                (revision_id,),
            ).fetchone()
            return (str(row["content"]), row["raw_bytes"]) if row else ("", None)
        finally:
            connection.close()

    def tags(self, revision_id: str) -> list[AnnotationTag]:
        connection = connect(self._database_path)
        try:
            rows = connection.execute(
                """
                SELECT name, category, confidence, origin
                FROM annotation_tag_items
                WHERE revision_id = ?
                ORDER BY position
                """,
                (revision_id,),
            ).fetchall()
            return [AnnotationTag.model_validate(dict(row)) for row in rows]
        finally:
            connection.close()

    def revision_tags_many(
        self,
        revision_ids: Sequence[str],
    ) -> dict[str, list[AnnotationTag]]:
        unique_ids = list(dict.fromkeys(revision_id for revision_id in revision_ids if revision_id))
        result = {revision_id: [] for revision_id in unique_ids}
        if not unique_ids:
            return result
        connection = connect(self._database_path)
        try:
            for start in range(0, len(unique_ids), 500):
                batch = unique_ids[start : start + 500]
                placeholders = ",".join("?" for _ in batch)
                rows = connection.execute(
                    f"""
                    SELECT revision_id, name, category, confidence, origin
                    FROM annotation_tag_items
                    WHERE revision_id IN ({placeholders})
                    ORDER BY revision_id, position
                    """,
                    batch,
                ).fetchall()
                for row in rows:
                    result[str(row["revision_id"])].append(
                        AnnotationTag.model_validate(
                            {
                                "name": row["name"],
                                "category": row["category"],
                                "confidence": row["confidence"],
                                "origin": row["origin"],
                            }
                        )
                    )
        finally:
            connection.close()
        return result

    def usable_revision_id(
        self,
        asset_id: str,
        channel: AnnotationChannel,
        language: str = "",
        *,
        require_current_image: bool = True,
        translation_source_kind: TranslationSourceKind | str = DEFAULT_TRANSLATION_SOURCE_KIND,
        translation_producer_kind: TranslationProducerKind
        | str = DEFAULT_TRANSLATION_PRODUCER_KIND,
    ) -> str | None:
        row = self.get_document_row(
            asset_id,
            channel,
            language,
            translation_source_kind,
            translation_producer_kind,
        )
        if row is None:
            return None
        state = resolve_document_row_state(row)
        if not state.exists or state.validation_status in INVALID_VALIDATION_STATUSES:
            return None
        if require_current_image and state.image_stale:
            return None
        if channel == AnnotationChannel.TRANSLATION and state.dependency_stale:
            return None
        return str(row["head_revision_id"])

    def head_revision_id(
        self,
        asset_id: str,
        channel: AnnotationChannel,
        language: str = "",
        translation_source_kind: TranslationSourceKind | str = DEFAULT_TRANSLATION_SOURCE_KIND,
        translation_producer_kind: TranslationProducerKind
        | str = DEFAULT_TRANSLATION_PRODUCER_KIND,
    ) -> str | None:
        source_value, producer_value = self._identity_values(
            channel,
            translation_source_kind,
            translation_producer_kind,
        )
        connection = connect(self._database_path)
        try:
            row = connection.execute(
                """
                SELECT head_revision_id
                FROM annotation_documents
                WHERE asset_id = ? AND channel = ? AND language = ?
                  AND translation_source_kind = ?
                  AND translation_producer_kind = ?
                """,
                (asset_id, channel.value, language, source_value, producer_value),
            ).fetchone()
            return str(row["head_revision_id"]) if row and row["head_revision_id"] else None
        finally:
            connection.close()

    def write_text(
        self,
        *,
        asset_id: str,
        channel: AnnotationChannel,
        language: str = "",
        translation_source_kind: TranslationSourceKind | str = DEFAULT_TRANSLATION_SOURCE_KIND,
        translation_producer_kind: TranslationProducerKind
        | str = DEFAULT_TRANSLATION_PRODUCER_KIND,
        content: str,
        raw_bytes: bytes | None = None,
        source: str,
        validation_status: AnnotationStatus,
        image_content_hash: str,
        expected_head_revision_id: str | None | object = _EXPECTED_HEAD_UNSET,
        review: bool = False,
        source_job_item_id: str | None = None,
        input_revisions: Sequence[tuple[str, str]] = (),
        metadata: dict[str, object] | None = None,
        allow_candidate_on_conflict: bool = False,
    ) -> RevisionWrite:
        with transaction(self._database_path) as connection:
            return self.write_text_in_transaction(
                connection,
                asset_id=asset_id,
                channel=channel,
                language=language,
                translation_source_kind=translation_source_kind,
                translation_producer_kind=translation_producer_kind,
                content=content,
                raw_bytes=raw_bytes,
                source=source,
                validation_status=validation_status,
                image_content_hash=image_content_hash,
                expected_head_revision_id=expected_head_revision_id,
                review=review,
                source_job_item_id=source_job_item_id,
                input_revisions=input_revisions,
                metadata=metadata,
                allow_candidate_on_conflict=allow_candidate_on_conflict,
            )

    def write_text_in_transaction(
        self,
        connection: sqlite3.Connection,
        **kwargs,
    ) -> RevisionWrite:
        return self._write_revision(
            connection,
            content_kind=AnnotationContentKind.TEXT,
            text_content=kwargs.pop("content"),
            raw_bytes=kwargs.pop("raw_bytes", None),
            tags=(),
            **kwargs,
        )

    def write_tags(
        self,
        *,
        asset_id: str,
        tags: Sequence[AnnotationTag],
        source: str,
        validation_status: AnnotationStatus,
        image_content_hash: str,
        expected_head_revision_id: str | None | object = _EXPECTED_HEAD_UNSET,
        review: bool = False,
        source_job_item_id: str | None = None,
        input_revisions: Sequence[tuple[str, str]] = (),
        metadata: dict[str, object] | None = None,
        allow_candidate_on_conflict: bool = False,
    ) -> RevisionWrite:
        with transaction(self._database_path) as connection:
            return self._write_revision(
                connection,
                asset_id=asset_id,
                channel=AnnotationChannel.TAGS,
                language="",
                translation_source_kind=DEFAULT_TRANSLATION_SOURCE_KIND,
                translation_producer_kind=DEFAULT_TRANSLATION_PRODUCER_KIND,
                content_kind=AnnotationContentKind.TAGS,
                text_content=None,
                raw_bytes=None,
                tags=tags,
                source=source,
                validation_status=validation_status,
                image_content_hash=image_content_hash,
                expected_head_revision_id=expected_head_revision_id,
                review=review,
                source_job_item_id=source_job_item_id,
                input_revisions=input_revisions,
                metadata=metadata,
                allow_candidate_on_conflict=allow_candidate_on_conflict,
            )

    def write_tags_in_transaction(
        self,
        connection: sqlite3.Connection,
        **kwargs,
    ) -> RevisionWrite:
        return self._write_revision(
            connection,
            channel=AnnotationChannel.TAGS,
            language="",
            translation_source_kind=DEFAULT_TRANSLATION_SOURCE_KIND,
            translation_producer_kind=DEFAULT_TRANSLATION_PRODUCER_KIND,
            content_kind=AnnotationContentKind.TAGS,
            text_content=None,
            raw_bytes=None,
            **kwargs,
        )

    def write_tags_many(
        self,
        requests: Sequence[TagRevisionWriteRequest],
    ) -> list[RevisionWrite]:
        if not requests:
            return []
        writes: list[RevisionWrite] = []
        with transaction(self._database_path) as connection:
            for request in requests:
                asset = connection.execute(
                    "SELECT content_hash FROM assets WHERE id = ? AND is_present = 1",
                    (request.asset_id,),
                ).fetchone()
                if asset is None:
                    raise ResourceConflictError("批量编辑目标素材已不存在，未写入任何 Tags。")
                if str(asset["content_hash"]) != request.image_content_hash:
                    raise ResourceConflictError("素材在批量编辑期间发生变化，请重新预览。")
                writes.append(
                    self.write_tags_in_transaction(
                        connection,
                        asset_id=request.asset_id,
                        tags=request.tags,
                        source=request.source,
                        validation_status=request.validation_status,
                        image_content_hash=request.image_content_hash,
                        expected_head_revision_id=request.expected_head_revision_id,
                        review=False,
                        source_job_item_id=None,
                        input_revisions=(),
                        metadata=None,
                        allow_candidate_on_conflict=False,
                    )
                )
        return writes

    def delete(
        self,
        *,
        asset_id: str,
        channel: AnnotationChannel,
        language: str = "",
        translation_source_kind: TranslationSourceKind | str = DEFAULT_TRANSLATION_SOURCE_KIND,
        translation_producer_kind: TranslationProducerKind
        | str = DEFAULT_TRANSLATION_PRODUCER_KIND,
        expected_head_revision_id: str | None | object = _EXPECTED_HEAD_UNSET,
        source: str = "manual_delete",
    ) -> RevisionWrite | None:
        with transaction(self._database_path) as connection:
            return self._delete_in_transaction(
                connection,
                asset_id=asset_id,
                channel=channel,
                language=language,
                translation_source_kind=translation_source_kind,
                translation_producer_kind=translation_producer_kind,
                expected_head_revision_id=expected_head_revision_id,
                source=source,
            )

    def delete_many(
        self,
        targets: Sequence[tuple[str, AnnotationChannel, str, str, str]],
    ) -> list[tuple[str, AnnotationChannel, str, str, str]]:
        if not targets:
            return []
        deleted: list[tuple[str, AnnotationChannel, str, str, str]] = []
        with transaction(self._database_path) as connection:
            for asset_id, channel, language, source_kind, producer_kind in targets:
                write = self._delete_in_transaction(
                    connection,
                    asset_id=asset_id,
                    channel=channel,
                    language=language,
                    translation_source_kind=source_kind,
                    translation_producer_kind=producer_kind,
                )
                if write is not None:
                    deleted.append((asset_id, channel, language, source_kind, producer_kind))
        return deleted

    def _delete_in_transaction(
        self,
        connection: sqlite3.Connection,
        *,
        asset_id: str,
        channel: AnnotationChannel,
        language: str,
        translation_source_kind: TranslationSourceKind | str = DEFAULT_TRANSLATION_SOURCE_KIND,
        translation_producer_kind: TranslationProducerKind
        | str = DEFAULT_TRANSLATION_PRODUCER_KIND,
        expected_head_revision_id: str | None | object = _EXPECTED_HEAD_UNSET,
        source: str = "manual_delete",
    ) -> RevisionWrite | None:
        document = self._document(
            connection,
            asset_id,
            channel,
            language,
            translation_source_kind,
            translation_producer_kind,
            create=False,
        )
        if document is None or not document["head_revision_id"]:
            return None
        head = connection.execute(
            """
            SELECT is_tombstone
            FROM annotation_document_revisions
            WHERE id = ?
            """,
            (str(document["head_revision_id"]),),
        ).fetchone()
        if head is None or bool(head["is_tombstone"]):
            return None
        return self._write_revision(
            connection,
            asset_id=asset_id,
            channel=channel,
            language=language,
            translation_source_kind=translation_source_kind,
            translation_producer_kind=translation_producer_kind,
            content_kind=AnnotationContentKind(str(document["content_kind"])),
            text_content=None,
            raw_bytes=None,
            tags=(),
            source=source,
            validation_status=AnnotationStatus.MISSING,
            image_content_hash=self._asset_hash(connection, asset_id),
            expected_head_revision_id=expected_head_revision_id,
            review=False,
            source_job_item_id=None,
            input_revisions=(),
            metadata=None,
            allow_candidate_on_conflict=False,
            is_tombstone=True,
        )

    def review(
        self,
        asset_id: str,
        channel: AnnotationChannel,
        language: str,
        expected_head_revision_id: str,
        translation_source_kind: TranslationSourceKind | str = DEFAULT_TRANSLATION_SOURCE_KIND,
        translation_producer_kind: TranslationProducerKind
        | str = DEFAULT_TRANSLATION_PRODUCER_KIND,
    ) -> str:
        return AnnotationReviewRepository(self._database_path).review(
            asset_id,
            channel,
            language,
            expected_head_revision_id,
            translation_source_kind,
            translation_producer_kind,
        )

    def review_many(
        self,
        revisions: Sequence[tuple[str, AnnotationChannel, str, str, str, str]],
    ) -> list[str]:
        return AnnotationReviewRepository(self._database_path).review_many(revisions)

    def history_rows(
        self,
        asset_id: str,
        channel: AnnotationChannel | None = None,
        language: str = "",
        translation_source_kind: TranslationSourceKind | str = DEFAULT_TRANSLATION_SOURCE_KIND,
        translation_producer_kind: TranslationProducerKind
        | str = DEFAULT_TRANSLATION_PRODUCER_KIND,
    ) -> list[sqlite3.Row]:
        connection = connect(self._database_path)
        try:
            clauses = ["d.asset_id = ?"]
            parameters: list[object] = [asset_id]
            if channel is not None:
                source_value, producer_value = self._identity_values(
                    channel,
                    translation_source_kind,
                    translation_producer_kind,
                )
                clauses.extend(
                    (
                        "d.channel = ?",
                        "d.language = ?",
                        "d.translation_source_kind = ?",
                        "d.translation_producer_kind = ?",
                    )
                )
                parameters.extend((channel.value, language, source_value, producer_value))
            return connection.execute(
                f"""
                SELECT r.*, d.channel, d.language,
                       d.translation_source_kind, d.translation_producer_kind,
                       d.content_kind
                FROM annotation_document_revisions r
                JOIN annotation_documents d ON d.id = r.document_id
                WHERE {" AND ".join(clauses)}
                ORDER BY r.created_at DESC, r.rowid DESC
                """,
                parameters,
            ).fetchall()
        finally:
            connection.close()

    def revision_text(self, revision_id: str) -> str:
        return self.text_content(revision_id)[0]

    def revision_tags(self, revision_id: str) -> list[AnnotationTag]:
        return self.tags(revision_id)

    def tag_names(self, revision_id: str) -> list[str]:
        connection = connect(self._database_path)
        try:
            return [
                str(row["name"])
                for row in connection.execute(
                    """
                    SELECT name
                    FROM annotation_tag_items
                    WHERE revision_id = ?
                    ORDER BY position
                    """,
                    (revision_id,),
                ).fetchall()
            ]
        finally:
            connection.close()

    def revision_exists(self, revision_id: str) -> bool:
        connection = connect(self._database_path)
        try:
            return (
                connection.execute(
                    "SELECT 1 FROM annotation_document_revisions WHERE id = ?",
                    (revision_id,),
                ).fetchone()
                is not None
            )
        finally:
            connection.close()

    def revision_validation_status(self, revision_id: str) -> AnnotationStatus | None:
        connection = connect(self._database_path)
        try:
            row = connection.execute(
                """
                SELECT validation_status
                FROM annotation_document_revisions
                WHERE id = ? AND is_tombstone = 0
                """,
                (revision_id,),
            ).fetchone()
            return AnnotationStatus(str(row["validation_status"])) if row else None
        finally:
            connection.close()

    def revision_matches_current_image(self, revision_id: str) -> bool:
        connection = connect(self._database_path)
        try:
            row = connection.execute(
                """
                SELECT r.image_content_hash, a.content_hash AS current_image_hash
                FROM annotation_document_revisions r
                JOIN annotation_documents d ON d.id = r.document_id
                JOIN assets a ON a.id = d.asset_id
                WHERE r.id = ? AND a.is_present = 1
                """,
                (revision_id,),
            ).fetchone()
            return bool(row and str(row["image_content_hash"]) == str(row["current_image_hash"]))
        finally:
            connection.close()

    def revision_inputs(self, revision_id: str) -> list[tuple[str, str]]:
        connection = connect(self._database_path)
        try:
            return [
                (str(row["input_revision_id"]), str(row["role"]))
                for row in connection.execute(
                    """
                    SELECT input_revision_id, role
                    FROM annotation_revision_inputs
                    WHERE output_revision_id = ?
                    ORDER BY role, input_revision_id
                    """,
                    (revision_id,),
                ).fetchall()
            ]
        finally:
            connection.close()

    def revision_metadata(self, revision_id: str) -> dict[str, object]:
        connection = connect(self._database_path)
        try:
            row = connection.execute(
                """
                SELECT metadata_json
                FROM annotation_document_revisions
                WHERE id = ?
                """,
                (revision_id,),
            ).fetchone()
            if row is None:
                return {}
            try:
                value = json.loads(str(row["metadata_json"]))
            except json.JSONDecodeError:
                return {}
            return value if isinstance(value, dict) else {}
        finally:
            connection.close()

    def _write_revision(
        self,
        connection: sqlite3.Connection,
        *,
        asset_id: str,
        channel: AnnotationChannel,
        language: str,
        translation_source_kind: TranslationSourceKind | str = DEFAULT_TRANSLATION_SOURCE_KIND,
        translation_producer_kind: TranslationProducerKind
        | str = DEFAULT_TRANSLATION_PRODUCER_KIND,
        content_kind: AnnotationContentKind,
        text_content: str | None,
        raw_bytes: bytes | None,
        tags: Sequence[AnnotationTag],
        source: str,
        validation_status: AnnotationStatus,
        image_content_hash: str,
        expected_head_revision_id: str | None | object,
        review: bool,
        source_job_item_id: str | None,
        input_revisions: Sequence[tuple[str, str]],
        metadata: dict[str, object] | None,
        allow_candidate_on_conflict: bool,
        is_tombstone: bool = False,
    ) -> RevisionWrite:
        document = self._document(
            connection,
            asset_id,
            channel,
            language,
            translation_source_kind,
            translation_producer_kind,
            create=True,
            content_kind=content_kind,
        )
        assert document is not None
        current_head = str(document["head_revision_id"]) if document["head_revision_id"] else None
        conflicted = (
            expected_head_revision_id is not _EXPECTED_HEAD_UNSET
            and expected_head_revision_id != current_head
        )
        if conflicted and not allow_candidate_on_conflict:
            raise ResourceConflictError("标注版本已经变化，当前结果未覆盖新内容。")

        revision_id = str(uuid.uuid4())
        now = utc_now_iso()
        base_revision_id = (
            expected_head_revision_id
            if expected_head_revision_id is not _EXPECTED_HEAD_UNSET
            else current_head
        )
        if base_revision_id is not None and not self._revision_belongs_to_document(
            connection,
            base_revision_id,
            str(document["id"]),
        ):
            base_revision_id = None
        parent_revision_id = base_revision_id if conflicted else current_head
        connection.execute(
            """
            INSERT INTO annotation_document_revisions (
                id, document_id, parent_revision_id, base_revision_id,
                source, source_job_item_id, image_content_hash,
                validation_status, is_tombstone, is_candidate,
                metadata_json, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                revision_id,
                str(document["id"]),
                parent_revision_id,
                base_revision_id,
                source,
                source_job_item_id,
                image_content_hash,
                validation_status.value,
                int(is_tombstone),
                int(conflicted),
                json.dumps(metadata or {}, ensure_ascii=False, separators=(",", ":")),
                now,
            ),
        )
        if not is_tombstone:
            if content_kind == AnnotationContentKind.TEXT:
                connection.execute(
                    """
                    INSERT INTO annotation_text_contents (
                        revision_id, content, format, raw_bytes
                    ) VALUES (?, ?, 'plain', ?)
                    """,
                    (revision_id, text_content or "", raw_bytes),
                )
            else:
                connection.executemany(
                    """
                    INSERT INTO annotation_tag_items (
                        revision_id, position, name, normalized_name,
                        category, confidence, origin
                    ) VALUES (?, ?, ?, ?, ?, ?, ?)
                    """,
                    [
                        (
                            revision_id,
                            position,
                            tag.name,
                            tag.name.casefold(),
                            tag.category,
                            tag.confidence,
                            tag.origin,
                        )
                        for position, tag in enumerate(tags)
                    ],
                )
        connection.executemany(
            """
            INSERT INTO annotation_revision_inputs (
                output_revision_id, input_revision_id, role
            ) VALUES (?, ?, ?)
            """,
            [(revision_id, input_revision_id, role) for input_revision_id, role in input_revisions],
        )

        if not conflicted:
            reviewed_revision_id = revision_id if review and not is_tombstone else None
            if review:
                connection.execute(
                    """
                    UPDATE annotation_documents
                    SET head_revision_id = ?, reviewed_revision_id = ?,
                        updated_at = ?
                    WHERE id = ?
                    """,
                    (
                        revision_id,
                        reviewed_revision_id,
                        now,
                        str(document["id"]),
                    ),
                )
            elif is_tombstone:
                connection.execute(
                    """
                    UPDATE annotation_documents
                    SET head_revision_id = ?, reviewed_revision_id = NULL,
                        updated_at = ?
                    WHERE id = ?
                    """,
                    (revision_id, now, str(document["id"])),
                )
            else:
                connection.execute(
                    """
                    UPDATE annotation_documents
                    SET head_revision_id = ?, updated_at = ?
                    WHERE id = ?
                    """,
                    (revision_id, now, str(document["id"])),
                )
            sync_asset_annotation_summary(connection, asset_id)
        return RevisionWrite(
            revision_id=revision_id,
            document_id=str(document["id"]),
            became_head=not conflicted,
        )

    @staticmethod
    def _revision_belongs_to_document(
        connection: sqlite3.Connection,
        revision_id: str,
        document_id: str,
    ) -> bool:
        return (
            connection.execute(
                """
                SELECT 1
                FROM annotation_document_revisions
                WHERE id = ? AND document_id = ?
                """,
                (revision_id, document_id),
            ).fetchone()
            is not None
        )

    @staticmethod
    def _asset_hash(connection: sqlite3.Connection, asset_id: str) -> str:
        row = connection.execute(
            "SELECT content_hash FROM assets WHERE id = ?",
            (asset_id,),
        ).fetchone()
        if row is None:
            raise ValueError(f"找不到素材：{asset_id}")
        return str(row["content_hash"])

    @staticmethod
    def _document(
        connection: sqlite3.Connection,
        asset_id: str,
        channel: AnnotationChannel,
        language: str,
        translation_source_kind: TranslationSourceKind | str,
        translation_producer_kind: TranslationProducerKind | str,
        *,
        create: bool,
        content_kind: AnnotationContentKind | None = None,
    ) -> sqlite3.Row | None:
        source_value, producer_value = AnnotationRepository._identity_values(
            channel,
            translation_source_kind,
            translation_producer_kind,
        )
        row = connection.execute(
            """
            SELECT *
            FROM annotation_documents
            WHERE asset_id = ? AND channel = ? AND language = ?
              AND translation_source_kind = ?
              AND translation_producer_kind = ?
            """,
            (asset_id, channel.value, language, source_value, producer_value),
        ).fetchone()
        if row is not None or not create:
            return row
        expected_kind, display_name = channel_definition(
            channel,
            language,
            translation_source_kind,
            translation_producer_kind,
        )
        if content_kind is not None and content_kind != expected_kind:
            raise ValueError("标注通道与内容类型不匹配。")
        now = utc_now_iso()
        document_id = str(uuid.uuid4())
        connection.execute(
            """
            INSERT INTO annotation_documents (
                id, asset_id, channel, language,
                translation_source_kind, translation_producer_kind, display_name,
                content_kind, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                document_id,
                asset_id,
                channel.value,
                language,
                source_value,
                producer_value,
                display_name,
                expected_kind.value,
                now,
                now,
            ),
        )
        return connection.execute(
            "SELECT * FROM annotation_documents WHERE id = ?",
            (document_id,),
        ).fetchone()

    @staticmethod
    def _identity_values(
        channel: AnnotationChannel,
        translation_source_kind: TranslationSourceKind | str,
        translation_producer_kind: TranslationProducerKind | str,
    ) -> tuple[str, str]:
        if channel == AnnotationChannel.TRANSLATION:
            return translation_identity_values(
                translation_source_kind,
                translation_producer_kind,
            )
        return "", ""

    @staticmethod
    def sync_asset_summary_in_transaction(
        connection: sqlite3.Connection,
        asset_id: str,
    ) -> None:
        sync_asset_annotation_summary(connection, asset_id)


EXPECTED_HEAD_UNSET = _EXPECTED_HEAD_UNSET
