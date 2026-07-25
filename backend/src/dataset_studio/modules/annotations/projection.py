from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any

from dataset_studio.modules.annotations.models import (
    AnnotationAvailabilityStatus,
    AnnotationChannel,
    AnnotationReviewStatus,
    AnnotationStatus,
)

INVALID_VALIDATION_VALUES = (
    AnnotationStatus.INVALID.value,
    AnnotationStatus.ENCODING_ERROR.value,
    AnnotationStatus.EMPTY.value,
    AnnotationStatus.UNCHECKED.value,
)
INVALID_VALIDATION_STATUSES = frozenset(
    AnnotationStatus(value) for value in INVALID_VALIDATION_VALUES
)


@dataclass(frozen=True, slots=True)
class ResolvedAnnotationState:
    exists: bool
    availability_status: AnnotationAvailabilityStatus
    review_status: AnnotationReviewStatus | None
    validation_status: AnnotationStatus | None
    image_stale: bool
    dependency_stale: bool
    dependency_revision_id: str | None
    current_source_revision_id: str | None

    @property
    def stale(self) -> bool:
        return self.image_stale or self.dependency_stale

    @property
    def reviewable(self) -> bool:
        if not self.exists or self.validation_status in INVALID_VALIDATION_STATUSES:
            return False
        return not self.dependency_stale


def resolve_annotation_state(
    *,
    channel: AnnotationChannel,
    revision_id: str | None,
    reviewed_revision_id: str | None,
    is_tombstone: bool,
    image_content_hash: str | None,
    current_image_hash: str | None,
    validation_status: AnnotationStatus | None,
    dependency_revision_id: str | None = None,
    current_source_revision_id: str | None = None,
) -> ResolvedAnnotationState:
    exists = bool(revision_id and not is_tombstone)
    image_stale = bool(
        exists
        and image_content_hash
        and current_image_hash
        and image_content_hash != current_image_hash
    )
    dependency_stale = bool(
        exists
        and channel == AnnotationChannel.TRANSLATION
        and (
            current_source_revision_id is None
            or dependency_revision_id != current_source_revision_id
        )
    )
    if not exists:
        availability_status = AnnotationAvailabilityStatus.MISSING
        review_status = None
    else:
        review_status = (
            AnnotationReviewStatus.REVIEWED
            if reviewed_revision_id == revision_id
            else AnnotationReviewStatus.UNREVIEWED
        )
        if image_stale or dependency_stale:
            availability_status = AnnotationAvailabilityStatus.STALE
        elif validation_status in INVALID_VALIDATION_STATUSES:
            availability_status = AnnotationAvailabilityStatus.INVALID
        else:
            availability_status = AnnotationAvailabilityStatus.USABLE
    return ResolvedAnnotationState(
        exists=exists,
        availability_status=availability_status,
        review_status=review_status,
        validation_status=validation_status,
        image_stale=image_stale,
        dependency_stale=dependency_stale,
        dependency_revision_id=dependency_revision_id,
        current_source_revision_id=current_source_revision_id,
    )


def resolve_document_row_state(row: Mapping[str, Any]) -> ResolvedAnnotationState:
    revision_id = str(row["head_revision_id"]) if row["head_revision_id"] else None
    reviewed_revision_id = str(row["reviewed_revision_id"]) if row["reviewed_revision_id"] else None
    validation_status = (
        AnnotationStatus(str(row["validation_status"]))
        if row["validation_status"] is not None
        else None
    )
    return resolve_annotation_state(
        channel=AnnotationChannel(str(row["channel"])),
        revision_id=revision_id,
        reviewed_revision_id=reviewed_revision_id,
        is_tombstone=bool(row["is_tombstone"]) if row["is_tombstone"] is not None else False,
        image_content_hash=(str(row["image_content_hash"]) if row["image_content_hash"] else None),
        current_image_hash=(str(row["current_image_hash"]) if row["current_image_hash"] else None),
        validation_status=validation_status,
        dependency_revision_id=(
            str(row["dependency_revision_id"]) if row["dependency_revision_id"] else None
        ),
        current_source_revision_id=(
            str(row["current_source_revision_id"]) if row["current_source_revision_id"] else None
        ),
    )


def current_usable_description_source_revision_sql(*, asset_alias: str) -> str:
    invalid_values = ", ".join(f"'{value}'" for value in INVALID_VALIDATION_VALUES)
    return f"""
    COALESCE(
        (
            SELECT description.head_revision_id
            FROM annotation_documents description
            JOIN annotation_document_revisions source_revision
              ON source_revision.id = description.head_revision_id
            WHERE description.asset_id = {asset_alias}.id
              AND description.channel = 'description'
              AND description.language = ''
              AND source_revision.is_tombstone = 0
              AND source_revision.image_content_hash = {asset_alias}.content_hash
              AND source_revision.validation_status NOT IN ({invalid_values})
            LIMIT 1
        ),
        (
            SELECT existing.head_revision_id
            FROM annotation_documents existing
            JOIN annotation_document_revisions source_revision
              ON source_revision.id = existing.head_revision_id
            WHERE existing.asset_id = {asset_alias}.id
              AND existing.channel = 'existing_annotation'
              AND existing.language = ''
              AND source_revision.is_tombstone = 0
              AND source_revision.image_content_hash = {asset_alias}.content_hash
              AND source_revision.validation_status NOT IN ({invalid_values})
            LIMIT 1
        )
    )
    """


def current_usable_tags_source_revision_sql(*, asset_alias: str) -> str:
    invalid_values = ", ".join(f"'{value}'" for value in INVALID_VALIDATION_VALUES)
    return f"""
    (
        SELECT tags.head_revision_id
        FROM annotation_documents tags
        JOIN annotation_document_revisions source_revision
          ON source_revision.id = tags.head_revision_id
        WHERE tags.asset_id = {asset_alias}.id
          AND tags.channel = 'tags'
          AND tags.language = ''
          AND source_revision.is_tombstone = 0
          AND source_revision.image_content_hash = {asset_alias}.content_hash
          AND source_revision.validation_status NOT IN ({invalid_values})
        LIMIT 1
    )
    """


def current_usable_source_revision_sql(
    *,
    asset_alias: str,
    source_kind_sql: str = "'description'",
) -> str:
    return f"""
    (
        CASE
            WHEN {source_kind_sql} = 'tags'
            THEN ({current_usable_tags_source_revision_sql(asset_alias=asset_alias)})
            ELSE ({current_usable_description_source_revision_sql(asset_alias=asset_alias)})
        END
    )
    """


def translation_dependency_revision_sql(*, revision_alias: str) -> str:
    return f"""
    (
        SELECT dependency.input_revision_id
        FROM annotation_revision_inputs dependency
        WHERE dependency.output_revision_id = {revision_alias}.id
          AND dependency.role = 'translation_source'
        ORDER BY dependency.input_revision_id
        LIMIT 1
    )
    """


def document_state_projection_sql(
    *,
    revision_alias: str = "r",
    asset_alias: str = "a",
    document_alias: str = "d",
) -> str:
    return f"""
    {translation_dependency_revision_sql(revision_alias=revision_alias)}
        AS dependency_revision_id,
    {
        current_usable_source_revision_sql(
            asset_alias=asset_alias,
            source_kind_sql=f"{document_alias}.translation_source_kind",
        )
    }
        AS current_source_revision_id
    """


def translation_dependency_stale_sql(
    *,
    document_alias: str,
    revision_alias: str,
    asset_alias: str,
) -> str:
    dependency = translation_dependency_revision_sql(revision_alias=revision_alias)
    current_source = current_usable_source_revision_sql(
        asset_alias=asset_alias,
        source_kind_sql=f"{document_alias}.translation_source_kind",
    )
    return f"""
    (
        {document_alias}.channel = 'translation'
        AND (
            ({current_source}) IS NULL
            OR ({dependency}) IS NULL
            OR ({dependency}) != ({current_source})
        )
    )
    """
