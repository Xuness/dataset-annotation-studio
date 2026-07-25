from __future__ import annotations

import json
import sqlite3
import uuid
from collections.abc import Sequence
from pathlib import Path

from dataset_studio.core.errors import ResourceConflictError
from dataset_studio.core.sqlite import transaction
from dataset_studio.core.time import utc_now_iso
from dataset_studio.modules.annotations.models import (
    AnnotationChannel,
    AnnotationContentKind,
    AnnotationStatus,
)
from dataset_studio.modules.annotations.projection import (
    INVALID_VALIDATION_STATUSES,
    current_usable_source_revision_sql,
    translation_dependency_revision_sql,
)
from dataset_studio.modules.annotations.summary import sync_asset_annotation_summary
from dataset_studio.modules.translations.identity import (
    DEFAULT_TRANSLATION_PRODUCER_KIND,
    DEFAULT_TRANSLATION_SOURCE_KIND,
    TranslationProducerKind,
    TranslationSourceKind,
    translation_identity_values,
)


class AnnotationReviewRepository:
    def __init__(self, database_path: Path) -> None:
        self._database_path = database_path

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
        with transaction(self._database_path) as connection:
            return self._review_in_transaction(
                connection,
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
        if not revisions:
            return []
        with transaction(self._database_path) as connection:
            return [
                self._review_in_transaction(
                    connection,
                    asset_id,
                    channel,
                    language,
                    expected_head_revision_id,
                    translation_source_kind,
                    translation_producer_kind,
                )
                for (
                    asset_id,
                    channel,
                    language,
                    translation_source_kind,
                    translation_producer_kind,
                    expected_head_revision_id,
                ) in revisions
            ]

    def _review_in_transaction(
        self,
        connection: sqlite3.Connection,
        asset_id: str,
        channel: AnnotationChannel,
        language: str,
        expected_head_revision_id: str,
        translation_source_kind: TranslationSourceKind | str,
        translation_producer_kind: TranslationProducerKind | str,
    ) -> str:
        document = self._document(
            connection,
            asset_id,
            channel,
            language,
            translation_source_kind,
            translation_producer_kind,
        )
        if document is None or not document["head_revision_id"]:
            raise ValueError("当前标注通道还没有可复核的版本。")
        current = str(document["head_revision_id"])
        if current != expected_head_revision_id:
            raise ResourceConflictError("标注版本已经变化，请刷新后再复核。")
        revision = connection.execute(
            """
            SELECT *
            FROM annotation_document_revisions
            WHERE id = ?
            """,
            (current,),
        ).fetchone()
        if revision is None or bool(revision["is_tombstone"]):
            raise ValueError("已删除的标注不能被复核。")

        validation_status = AnnotationStatus(str(revision["validation_status"]))
        if validation_status in INVALID_VALIDATION_STATUSES:
            raise ValueError("内容校验未通过，修复后才能标记为已复核。")
        now = utc_now_iso()
        current_image_hash = self._asset_hash(connection, asset_id)
        image_changed = str(revision["image_content_hash"]) != current_image_hash
        dependency_changed, current_source_revision_id = self._translation_dependency_change(
            connection,
            document,
            revision,
        )
        if dependency_changed:
            raise ValueError("译文的源标注已变化，请重新翻译后再复核。")

        reviewed_revision_id = current
        if image_changed or dependency_changed:
            reviewed_revision_id = self._copy_for_current_inputs(
                connection,
                document=document,
                revision=revision,
                current_revision_id=current,
                current_image_hash=current_image_hash,
                current_source_revision_id=current_source_revision_id,
                image_changed=image_changed,
                dependency_changed=dependency_changed,
                now=now,
            )
        connection.execute(
            """
            UPDATE annotation_documents
            SET head_revision_id = ?, reviewed_revision_id = ?, updated_at = ?
            WHERE id = ?
            """,
            (
                reviewed_revision_id,
                reviewed_revision_id,
                now,
                str(document["id"]),
            ),
        )
        sync_asset_annotation_summary(connection, asset_id)
        return reviewed_revision_id

    @staticmethod
    def _translation_dependency_change(
        connection: sqlite3.Connection,
        document: sqlite3.Row,
        revision: sqlite3.Row,
    ) -> tuple[bool, str | None]:
        if str(document["channel"]) != AnnotationChannel.TRANSLATION.value:
            return False, None
        dependency = connection.execute(
            f"""
            SELECT
                {translation_dependency_revision_sql(revision_alias="revision")}
                    AS dependency_revision_id,
                {
                current_usable_source_revision_sql(
                    asset_alias="asset",
                    source_kind_sql="document.translation_source_kind",
                )
            } AS current_source_revision_id
            FROM annotation_documents document
            JOIN assets asset ON asset.id = document.asset_id
            JOIN annotation_document_revisions revision ON revision.id = ?
            WHERE document.id = ?
            """,
            (str(revision["id"]), str(document["id"])),
        ).fetchone()
        current_source_revision_id = (
            str(dependency["current_source_revision_id"])
            if dependency and dependency["current_source_revision_id"]
            else None
        )
        dependency_revision_id = (
            str(dependency["dependency_revision_id"])
            if dependency and dependency["dependency_revision_id"]
            else None
        )
        return (
            current_source_revision_id is None
            or dependency_revision_id != current_source_revision_id,
            current_source_revision_id,
        )

    @classmethod
    def _copy_for_current_inputs(
        cls,
        connection: sqlite3.Connection,
        *,
        document: sqlite3.Row,
        revision: sqlite3.Row,
        current_revision_id: str,
        current_image_hash: str,
        current_source_revision_id: str | None,
        image_changed: bool,
        dependency_changed: bool,
        now: str,
    ) -> str:
        reviewed_revision_id = str(uuid.uuid4())
        metadata = cls._metadata(str(revision["metadata_json"]))
        if image_changed:
            metadata["reviewed_for_current_image_from_revision_id"] = current_revision_id
        if dependency_changed:
            metadata["reviewed_for_current_source_from_revision_id"] = current_revision_id
        connection.execute(
            """
            INSERT INTO annotation_document_revisions (
                id, document_id, parent_revision_id, base_revision_id,
                source, source_job_item_id, image_content_hash,
                validation_status, is_tombstone, is_candidate,
                metadata_json, created_at
            ) VALUES (?, ?, ?, ?, ?, NULL, ?, ?, 0, 0, ?, ?)
            """,
            (
                reviewed_revision_id,
                str(document["id"]),
                current_revision_id,
                current_revision_id,
                (
                    "manual_review_current_image"
                    if image_changed
                    else "manual_review_current_source"
                ),
                current_image_hash,
                str(revision["validation_status"]),
                json.dumps(metadata, ensure_ascii=False, separators=(",", ":")),
                now,
            ),
        )
        if str(document["content_kind"]) == AnnotationContentKind.TEXT.value:
            connection.execute(
                """
                INSERT INTO annotation_text_contents (
                    revision_id, content, format, raw_bytes
                )
                SELECT ?, content, format, raw_bytes
                FROM annotation_text_contents
                WHERE revision_id = ?
                """,
                (reviewed_revision_id, current_revision_id),
            )
        else:
            connection.execute(
                """
                INSERT INTO annotation_tag_items (
                    revision_id, position, name, normalized_name,
                    category, confidence, origin
                )
                SELECT ?, position, name, normalized_name,
                       category, confidence, origin
                FROM annotation_tag_items
                WHERE revision_id = ?
                """,
                (reviewed_revision_id, current_revision_id),
            )
        connection.execute(
            """
            INSERT INTO annotation_revision_inputs (
                output_revision_id, input_revision_id, role
            )
            SELECT ?, input_revision_id, role
            FROM annotation_revision_inputs
            WHERE output_revision_id = ?
              AND role != 'translation_source'
            """,
            (reviewed_revision_id, current_revision_id),
        )
        if current_source_revision_id is not None:
            connection.execute(
                """
                INSERT INTO annotation_revision_inputs (
                    output_revision_id, input_revision_id, role
                ) VALUES (?, ?, 'translation_source')
                """,
                (reviewed_revision_id, current_source_revision_id),
            )
        return reviewed_revision_id

    @staticmethod
    def _document(
        connection: sqlite3.Connection,
        asset_id: str,
        channel: AnnotationChannel,
        language: str,
        translation_source_kind: TranslationSourceKind | str,
        translation_producer_kind: TranslationProducerKind | str,
    ) -> sqlite3.Row | None:
        if channel == AnnotationChannel.TRANSLATION:
            source_value, producer_value = translation_identity_values(
                translation_source_kind,
                translation_producer_kind,
            )
        else:
            source_value, producer_value = "", ""
        return connection.execute(
            """
            SELECT *
            FROM annotation_documents
            WHERE asset_id = ? AND channel = ? AND language = ?
              AND translation_source_kind = ?
              AND translation_producer_kind = ?
            """,
            (asset_id, channel.value, language, source_value, producer_value),
        ).fetchone()

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
    def _metadata(value: str) -> dict[str, object]:
        try:
            metadata = json.loads(value)
        except json.JSONDecodeError:
            return {}
        return metadata if isinstance(metadata, dict) else {}
