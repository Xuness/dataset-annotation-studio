from __future__ import annotations

import hashlib
import json
import sqlite3
from collections import Counter
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path

from dataset_studio.core.errors import AssetNotFoundError
from dataset_studio.modules.annotations.models import (
    AnnotationChannel,
    AnnotationTag,
    AnnotationTagBatchAddOperation,
    AnnotationTagBatchDetailFilter,
    AnnotationTagBatchEditPreview,
    AnnotationTagBatchEditPreviewItem,
    AnnotationTagBatchEditPreviewPage,
    AnnotationTagBatchEditRequest,
    AnnotationTagBatchEditResult,
    AnnotationTagBatchInsertAnchor,
    AnnotationTagBatchInsertIndex,
    AnnotationTagBatchRemoveOperation,
    AnnotationTagBatchReplaceOperation,
    AnnotationTagBatchTermSummary,
)
from dataset_studio.modules.annotations.projection import resolve_document_row_state
from dataset_studio.modules.annotations.repository import AnnotationRepository
from dataset_studio.modules.assets.repository import AssetRepository


@dataclass(frozen=True, slots=True)
class TagBatchEditItemPlan:
    asset_id: str
    filename: str
    relative_path: str
    image_content_hash: str
    head_revision_id: str | None
    active_before: bool
    stale_before: bool
    before_tags: tuple[AnnotationTag, ...]
    after_tags: tuple[AnnotationTag, ...]
    invalidated_tag_translation_count: int
    position_skipped: bool
    position_clamped: bool

    @property
    def changed(self) -> bool:
        return self.before_tags != self.after_tags

    @property
    def created_or_revived(self) -> bool:
        return self.changed and not self.active_before

    @property
    def emptied(self) -> bool:
        return self.changed and not self.after_tags

    @property
    def stale_rebound(self) -> bool:
        return self.changed and self.stale_before


@dataclass(frozen=True, slots=True)
class TagBatchEditPlan:
    items: tuple[TagBatchEditItemPlan, ...]
    terms: tuple[AnnotationTagBatchTermSummary, ...]

    @property
    def changed_items(self) -> tuple[TagBatchEditItemPlan, ...]:
        return tuple(item for item in self.items if item.changed)

    def summary(self) -> dict[str, object]:
        changed = self.changed_items
        return {
            "requested_count": len(self.items),
            "changed_count": len(changed),
            "unchanged_count": len(self.items) - len(changed),
            "created_or_revived_count": sum(item.created_or_revived for item in changed),
            "emptied_count": sum(item.emptied for item in changed),
            "stale_rebound_count": sum(item.stale_rebound for item in changed),
            "invalidated_tag_translation_count": sum(
                item.invalidated_tag_translation_count for item in changed
            ),
            "position_skipped_count": sum(item.position_skipped for item in self.items),
            "position_clamped_count": sum(item.position_clamped for item in self.items),
            "terms": list(self.terms),
        }


@dataclass(frozen=True, slots=True)
class TagBatchTransform:
    tags: tuple[AnnotationTag, ...]
    position_skipped: bool = False
    position_clamped: bool = False


def build_tag_batch_edit_plan(
    database_path: Path,
    request: AnnotationTagBatchEditRequest,
) -> TagBatchEditPlan:
    assets = AssetRepository(database_path).get_assets(request.asset_ids)
    missing = [asset_id for asset_id in request.asset_ids if asset_id not in assets]
    if missing:
        raise AssetNotFoundError(f"找不到素材：{missing[0]}")

    repository = AnnotationRepository(database_path)
    document_rows = repository.list_document_rows_for_assets(request.asset_ids)
    tag_rows = {
        str(row["asset_id"]): row
        for row in document_rows
        if str(row["channel"]) == AnnotationChannel.TAGS.value
    }
    active_tag_revision_ids = [
        str(row["head_revision_id"])
        for row in tag_rows.values()
        if row["head_revision_id"] and resolve_document_row_state(row).exists
    ]
    tags_by_revision = repository.revision_tags_many(active_tag_revision_ids)
    current_tag_translation_counts = _current_tag_translation_counts(document_rows)

    items: list[TagBatchEditItemPlan] = []
    for asset_id in request.asset_ids:
        tag_row = tag_rows.get(asset_id)
        state = resolve_document_row_state(tag_row) if tag_row is not None else None
        active_before = bool(state and state.exists)
        head_revision_id = (
            str(tag_row["head_revision_id"])
            if tag_row is not None and tag_row["head_revision_id"]
            else None
        )
        before_tags = tuple(
            tags_by_revision.get(head_revision_id, []) if active_before and head_revision_id else []
        )
        transformation = _transform_tags(before_tags, request)
        items.append(
            TagBatchEditItemPlan(
                asset_id=asset_id,
                filename=str(assets[asset_id]["filename"]),
                relative_path=str(assets[asset_id]["relative_path"]),
                image_content_hash=str(assets[asset_id]["content_hash"]),
                head_revision_id=head_revision_id,
                active_before=active_before,
                stale_before=bool(state and state.image_stale),
                before_tags=before_tags,
                after_tags=transformation.tags,
                invalidated_tag_translation_count=current_tag_translation_counts.get(asset_id, 0),
                position_skipped=transformation.position_skipped,
                position_clamped=transformation.position_clamped,
            )
        )

    return TagBatchEditPlan(
        items=tuple(items),
        terms=tuple(_term_summaries(items, request)),
    )


def tag_batch_edit_preview_token(
    request: AnnotationTagBatchEditRequest,
    plan: TagBatchEditPlan,
) -> str:
    request_payload = request.model_dump(mode="json")
    request_payload["asset_ids"] = sorted(request.asset_ids)
    payload = {
        "request": request_payload,
        "items": [
            {
                "asset_id": item.asset_id,
                "image_content_hash": item.image_content_hash,
                "head_revision_id": item.head_revision_id,
                "active_before": item.active_before,
                "stale_before": item.stale_before,
                "invalidated_tag_translation_count": (item.invalidated_tag_translation_count),
                "before_tags": [tag.model_dump(mode="json") for tag in item.before_tags],
                "after_tags": [tag.model_dump(mode="json") for tag in item.after_tags],
                "position_skipped": item.position_skipped,
                "position_clamped": item.position_clamped,
            }
            for item in sorted(plan.items, key=lambda candidate: candidate.asset_id)
        ],
    }
    encoded = json.dumps(
        payload,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def to_tag_batch_edit_preview(
    request: AnnotationTagBatchEditRequest,
    plan: TagBatchEditPlan,
    *,
    detail_filter: AnnotationTagBatchDetailFilter = "changed",
    detail_offset: int = 0,
    detail_limit: int = 20,
) -> AnnotationTagBatchEditPreview:
    if detail_offset < 0:
        raise ValueError("预览明细偏移量不能小于零。")
    if not 1 <= detail_limit <= 50:
        raise ValueError("预览明细每页数量必须在 1 到 50 之间。")
    return AnnotationTagBatchEditPreview(
        **plan.summary(),
        preview_token=tag_batch_edit_preview_token(request, plan),
        details=_preview_page(
            plan,
            detail_filter=detail_filter,
            detail_offset=detail_offset,
            detail_limit=detail_limit,
        ),
    )


def to_tag_batch_edit_result(plan: TagBatchEditPlan) -> AnnotationTagBatchEditResult:
    return AnnotationTagBatchEditResult(
        **plan.summary(),
        changed_asset_ids=[item.asset_id for item in plan.changed_items],
    )


def tag_batch_edit_source(request: AnnotationTagBatchEditRequest) -> str:
    return f"manual_tag_batch_{request.operation.kind}"


def _preview_page(
    plan: TagBatchEditPlan,
    *,
    detail_filter: AnnotationTagBatchDetailFilter,
    detail_offset: int,
    detail_limit: int,
) -> AnnotationTagBatchEditPreviewPage:
    ordered = sorted(
        plan.items,
        key=lambda item: (item.relative_path.casefold(), item.relative_path, item.asset_id),
    )
    if detail_filter == "changed":
        filtered = [item for item in ordered if item.changed]
    elif detail_filter == "position_skipped":
        filtered = [item for item in ordered if item.position_skipped]
    else:
        filtered = ordered
    effective_offset = detail_offset
    if not filtered:
        effective_offset = 0
    elif detail_offset >= len(filtered):
        effective_offset = ((len(filtered) - 1) // detail_limit) * detail_limit
    page_items = filtered[effective_offset : effective_offset + detail_limit]
    return AnnotationTagBatchEditPreviewPage(
        filter=detail_filter,
        offset=effective_offset,
        limit=detail_limit,
        total=len(filtered),
        items=[_preview_item(item) for item in page_items],
    )


def _preview_item(item: TagBatchEditItemPlan) -> AnnotationTagBatchEditPreviewItem:
    return AnnotationTagBatchEditPreviewItem(
        asset_id=item.asset_id,
        filename=item.filename,
        relative_path=item.relative_path,
        content_version=item.image_content_hash,
        changed=item.changed,
        position_skipped=item.position_skipped,
        position_clamped=item.position_clamped,
        before_tags=list(item.before_tags),
        after_tags=list(item.after_tags),
        removed_indices=_unmatched_tag_indices(item.before_tags, item.after_tags),
        added_indices=_unmatched_tag_indices(item.after_tags, item.before_tags),
    )


def _unmatched_tag_indices(
    source: Sequence[AnnotationTag],
    comparison: Sequence[AnnotationTag],
) -> list[int]:
    remaining = Counter(_tag_identity(tag) for tag in comparison)
    unmatched: list[int] = []
    for index, tag in enumerate(source):
        identity = _tag_identity(tag)
        if remaining[identity]:
            remaining[identity] -= 1
        else:
            unmatched.append(index)
    return unmatched


def _tag_identity(tag: AnnotationTag) -> tuple[str, str | None, float | None, str]:
    return (tag.name.casefold(), tag.category, tag.confidence, tag.origin)


def _transform_tags(
    current: Sequence[AnnotationTag],
    request: AnnotationTagBatchEditRequest,
) -> TagBatchTransform:
    operation = request.operation
    if isinstance(operation, AnnotationTagBatchAddOperation):
        existing_keys = {tag.name.casefold() for tag in current}
        candidates: list[AnnotationTag] = []
        seen = set(existing_keys)
        for candidate in operation.tags:
            key = candidate.name.casefold()
            if key in seen:
                continue
            seen.add(key)
            candidates.append(candidate.to_annotation_tag())
        if not candidates:
            return TagBatchTransform(tags=tuple(current))

        position = operation.position
        position_index: int
        position_clamped = False
        if position.kind == "start":
            position_index = 0
        elif position.kind == "end":
            position_index = len(current)
        elif isinstance(position, AnnotationTagBatchInsertIndex):
            position_index = min(position.index, len(current))
            position_clamped = position.index > len(current)
        else:
            assert isinstance(position, AnnotationTagBatchInsertAnchor)
            anchor_key = position.anchor_name.casefold()
            anchor_index = next(
                (index for index, tag in enumerate(current) if tag.name.casefold() == anchor_key),
                None,
            )
            if anchor_index is None:
                return TagBatchTransform(tags=tuple(current), position_skipped=True)
            position_index = anchor_index + 1 if position.kind == "after" else anchor_index

        result = list(current)
        result[position_index:position_index] = candidates
        return TagBatchTransform(
            tags=tuple(result),
            position_clamped=position_clamped,
        )

    if isinstance(operation, AnnotationTagBatchRemoveOperation):
        removed = {name.casefold() for name in operation.tag_names}
        return TagBatchTransform(
            tags=tuple(tag for tag in current if tag.name.casefold() not in removed)
        )

    assert isinstance(operation, AnnotationTagBatchReplaceOperation)
    source_key = operation.source_name.casefold()
    replacement_key = operation.replacement.name.casefold()
    if not any(tag.name.casefold() == source_key for tag in current):
        return TagBatchTransform(tags=tuple(current))

    replacement_exists = any(tag.name.casefold() == replacement_key for tag in current)
    replacement = operation.replacement.to_annotation_tag()
    result: list[AnnotationTag] = []
    inserted = False
    for tag in current:
        if tag.name.casefold() != source_key:
            result.append(tag)
            continue
        if replacement_exists or inserted:
            continue
        result.append(replacement)
        inserted = True
    return TagBatchTransform(tags=tuple(result))


def _operation_terms(request: AnnotationTagBatchEditRequest) -> list[str]:
    operation = request.operation
    if isinstance(operation, AnnotationTagBatchAddOperation):
        return [tag.name for tag in operation.tags]
    if isinstance(operation, AnnotationTagBatchRemoveOperation):
        return list(operation.tag_names)
    assert isinstance(operation, AnnotationTagBatchReplaceOperation)
    return [operation.source_name, operation.replacement.name]


def _term_summaries(
    items: Sequence[TagBatchEditItemPlan],
    request: AnnotationTagBatchEditRequest,
) -> list[AnnotationTagBatchTermSummary]:
    summaries: list[AnnotationTagBatchTermSummary] = []
    for name in _operation_terms(request):
        key = name.casefold()
        present_before_count = 0
        added_count = 0
        removed_count = 0
        for item in items:
            before = {tag.name.casefold() for tag in item.before_tags}
            after = {tag.name.casefold() for tag in item.after_tags}
            present_before_count += key in before
            added_count += key not in before and key in after
            removed_count += key in before and key not in after
        summaries.append(
            AnnotationTagBatchTermSummary(
                name=name,
                present_before_count=present_before_count,
                added_count=added_count,
                removed_count=removed_count,
            )
        )
    return summaries


def _current_tag_translation_counts(
    document_rows: Sequence[sqlite3.Row],
) -> dict[str, int]:
    counts: dict[str, int] = {}
    for row in document_rows:
        if (
            str(row["channel"]) != AnnotationChannel.TRANSLATION.value
            or str(row["translation_source_kind"]) != "tags"
        ):
            continue
        state = resolve_document_row_state(row)
        if state.exists and not state.dependency_stale:
            asset_id = str(row["asset_id"])
            counts[asset_id] = counts.get(asset_id, 0) + 1
    return counts
