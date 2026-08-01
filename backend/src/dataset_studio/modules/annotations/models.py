from __future__ import annotations

from enum import StrEnum
from typing import Annotated, Literal

from pydantic import AliasChoices, BaseModel, ConfigDict, Field, field_validator, model_validator

from dataset_studio.core.languages import normalize_language_code
from dataset_studio.modules.translations.identity import (
    DEFAULT_TRANSLATION_PRODUCER_KIND,
    DEFAULT_TRANSLATION_SOURCE_KIND,
    TranslationProducerKind,
    TranslationSourceKind,
)


class AnnotationStatus(StrEnum):
    """Validation-oriented compatibility status used by existing asset filters."""

    MISSING = "missing"
    VALID = "valid"
    INVALID = "invalid"
    ENCODING_ERROR = "encoding_error"
    EMPTY = "empty"
    UNCHECKED = "unchecked"
    MANUALLY_ACCEPTED = "manually_accepted"


class AnnotationChannel(StrEnum):
    EXISTING = "existing_annotation"
    TAGS = "tags"
    DESCRIPTION = "description"
    TRANSLATION = "translation"


class AnnotationContentKind(StrEnum):
    TEXT = "text"
    TAGS = "tags"


class AnnotationReviewStatus(StrEnum):
    UNREVIEWED = "unreviewed"
    REVIEWED = "reviewed"


class AnnotationAvailabilityStatus(StrEnum):
    MISSING = "missing"
    USABLE = "usable"
    INVALID = "invalid"
    STALE = "stale"


class ValidationIssue(BaseModel):
    code: str
    message: str
    offset: int | None = None
    tag: str | None = None


class ValidationResult(BaseModel):
    valid: bool
    status: AnnotationStatus
    tag_count: int = 0
    issues: list[ValidationIssue] = Field(default_factory=list)


class AnnotationTag(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=500)
    category: str | None = Field(default=None, max_length=120)
    confidence: float | None = Field(default=None, ge=0, le=1)
    origin: str = Field(default="manual", min_length=1, max_length=80)

    @field_validator("name")
    @classmethod
    def normalize_name(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("Tag 名称不能为空。")
        if "\x00" in normalized:
            raise ValueError("Tag 名称不能包含空字符。")
        return normalized

    @field_validator("category")
    @classmethod
    def normalize_optional_text(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip()
        return normalized or None

    @field_validator("origin")
    @classmethod
    def normalize_origin(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("Tag 来源不能为空。")
        return normalized


class AnnotationManualTagInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=500)
    category: str | None = Field(default=None, max_length=120)

    @field_validator("name")
    @classmethod
    def normalize_name(cls, value: str) -> str:
        return AnnotationTag.normalize_name(value)

    @field_validator("category")
    @classmethod
    def normalize_category(cls, value: str | None) -> str | None:
        return AnnotationTag.normalize_optional_text(value)

    def to_annotation_tag(self) -> AnnotationTag:
        return AnnotationTag(
            name=self.name,
            category=self.category,
            confidence=None,
            origin="manual",
        )


class AnnotationTaggerSource(BaseModel):
    installation_id: str
    installation_name: str
    adapter_id: str
    model_version: str
    fingerprint: str


class AnnotationDocument(BaseModel):
    """A database-backed annotation channel.

    ``path`` and ``modified_at`` remain as compatibility fields for older
    clients. ``modified_at`` contains the immutable head revision id rather
    than a filesystem mtime.
    """

    asset_id: str
    document_id: str | None = None
    channel: AnnotationChannel = AnnotationChannel.DESCRIPTION
    language: str | None = None
    translation_source_kind: TranslationSourceKind | None = None
    translation_producer_kind: TranslationProducerKind | None = None
    display_name: str = "LLM 描述"
    content_kind: AnnotationContentKind = AnnotationContentKind.TEXT
    path: str = ""
    exists: bool
    content: str = ""
    tags: list[AnnotationTag] = Field(default_factory=list)
    status: AnnotationStatus
    availability_status: AnnotationAvailabilityStatus = AnnotationAvailabilityStatus.MISSING
    review_status: AnnotationReviewStatus | None = None
    validation: ValidationResult | None = None
    validation_status: AnnotationStatus | None = None
    modified_at: str | None = None
    head_revision_id: str | None = None
    reviewed_revision_id: str | None = None
    image_content_hash: str | None = None
    current_image_hash: str | None = None
    source: str | None = None
    tagger_source: AnnotationTaggerSource | None = None
    updated_at: str | None = None


class AnnotationBundle(BaseModel):
    asset_id: str
    documents: list[AnnotationDocument] = Field(default_factory=list)


class AnnotationUpdate(BaseModel):
    """Compatibility request for the default description channel."""

    model_config = ConfigDict(extra="forbid")

    content: str
    expected_modified_at: str | None

    @field_validator("expected_modified_at")
    @classmethod
    def validate_expected_modified_at(cls, value: str | None) -> str | None:
        if value is not None and not value.strip():
            raise ValueError("标注版本不能为空。")
        return value


class AnnotationChannelUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    content: str | None = None
    tags: list[AnnotationTag] | None = None
    expected_head_revision_id: str | None = None
    review: bool | None = Field(
        default=None,
        validation_alias=AliasChoices("review", "confirm"),
    )

    @model_validator(mode="after")
    def validate_payload(self) -> AnnotationChannelUpdate:
        if (self.content is None) == (self.tags is None):
            raise ValueError("文本内容和 Tags 必须且只能提供一种。")
        return self


class AnnotationReviewRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    expected_head_revision_id: str = Field(min_length=1)


class AnnotationChannelTarget(BaseModel):
    model_config = ConfigDict(extra="forbid")

    channel: AnnotationChannel
    language: str = ""
    translation_source_kind: TranslationSourceKind | None = None
    translation_producer_kind: TranslationProducerKind | None = None

    @model_validator(mode="after")
    def validate_language(self) -> AnnotationChannelTarget:
        if self.channel == AnnotationChannel.TRANSLATION:
            if not self.language:
                raise ValueError("翻译标注通道必须指定语言。")
            try:
                self.language = normalize_language_code(self.language)
            except ValueError as error:
                raise ValueError("翻译标注通道的语言代码无效。") from error
            self.translation_source_kind = (
                self.translation_source_kind or DEFAULT_TRANSLATION_SOURCE_KIND
            )
            self.translation_producer_kind = (
                self.translation_producer_kind or DEFAULT_TRANSLATION_PRODUCER_KIND
            )
        elif (
            self.language
            or self.translation_source_kind is not None
            or self.translation_producer_kind is not None
        ):
            raise ValueError("只有翻译标注通道可以指定译文身份。")
        return self

    @property
    def key(self) -> str:
        if self.channel != AnnotationChannel.TRANSLATION:
            return self.channel.value
        assert self.translation_source_kind is not None
        assert self.translation_producer_kind is not None
        return (
            f"{self.channel.value}:{self.translation_source_kind.value}:"
            f"{self.translation_producer_kind.value}:{self.language}"
        )


def _normalize_asset_ids(value: list[str]) -> list[str]:
    normalized = list(dict.fromkeys(asset_id for asset_id in value if asset_id))
    if not normalized:
        raise ValueError("至少需要选择一个素材。")
    return normalized


def _validate_targets(value: list[AnnotationChannelTarget]) -> list[AnnotationChannelTarget]:
    if len({target.key for target in value}) != len(value):
        raise ValueError("同一个标注通道不能重复选择。")
    return value


def _validate_optional_targets(
    value: list[AnnotationChannelTarget] | None,
) -> list[AnnotationChannelTarget] | None:
    return _validate_targets(value) if value is not None else None


def _normalize_manual_tags(
    value: list[AnnotationManualTagInput],
) -> list[AnnotationManualTagInput]:
    normalized: list[AnnotationManualTagInput] = []
    seen: set[str] = set()
    for tag in value:
        key = tag.name.casefold()
        if key in seen:
            continue
        seen.add(key)
        normalized.append(tag)
    return normalized


def _normalize_tag_names(value: list[str]) -> list[str]:
    normalized: list[str] = []
    seen: set[str] = set()
    for name in value:
        clean = AnnotationTag.normalize_name(name)
        key = clean.casefold()
        if key in seen:
            continue
        seen.add(key)
        normalized.append(clean)
    return normalized


class AnnotationTagBatchInsertStart(BaseModel):
    model_config = ConfigDict(extra="forbid")

    kind: Literal["start"]


class AnnotationTagBatchInsertEnd(BaseModel):
    model_config = ConfigDict(extra="forbid")

    kind: Literal["end"]


class AnnotationTagBatchInsertIndex(BaseModel):
    model_config = ConfigDict(extra="forbid")

    kind: Literal["index"]
    index: int = Field(ge=0)


class AnnotationTagBatchInsertAnchor(BaseModel):
    model_config = ConfigDict(extra="forbid")

    kind: Literal["before", "after"]
    anchor_name: str = Field(min_length=1, max_length=500)

    @field_validator("anchor_name")
    @classmethod
    def normalize_anchor_name(cls, value: str) -> str:
        return AnnotationTag.normalize_name(value)


AnnotationTagBatchInsertPosition = Annotated[
    AnnotationTagBatchInsertStart
    | AnnotationTagBatchInsertEnd
    | AnnotationTagBatchInsertIndex
    | AnnotationTagBatchInsertAnchor,
    Field(discriminator="kind"),
]


class AnnotationTagBatchAddOperation(BaseModel):
    model_config = ConfigDict(extra="forbid")

    kind: Literal["add"]
    tags: list[AnnotationManualTagInput] = Field(min_length=1)
    position: AnnotationTagBatchInsertPosition = Field(
        default_factory=lambda: AnnotationTagBatchInsertEnd(kind="end")
    )

    _normalize_tags = field_validator("tags")(_normalize_manual_tags)


class AnnotationTagBatchRemoveOperation(BaseModel):
    model_config = ConfigDict(extra="forbid")

    kind: Literal["remove"]
    tag_names: list[str] = Field(min_length=1)

    _normalize_names = field_validator("tag_names")(_normalize_tag_names)


class AnnotationTagBatchReplaceOperation(BaseModel):
    model_config = ConfigDict(extra="forbid")

    kind: Literal["replace"]
    source_name: str = Field(min_length=1, max_length=500)
    replacement: AnnotationManualTagInput

    @field_validator("source_name")
    @classmethod
    def normalize_source_name(cls, value: str) -> str:
        return AnnotationTag.normalize_name(value)

    @model_validator(mode="after")
    def validate_distinct_names(self) -> AnnotationTagBatchReplaceOperation:
        if self.source_name.casefold() == self.replacement.name.casefold():
            raise ValueError("替换前后的 Tag 不能相同。")
        return self


AnnotationTagBatchOperation = Annotated[
    AnnotationTagBatchAddOperation
    | AnnotationTagBatchRemoveOperation
    | AnnotationTagBatchReplaceOperation,
    Field(discriminator="kind"),
]

AnnotationTagBatchDetailFilter = Literal["changed", "position_skipped", "all"]


class AnnotationTagBatchEditRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    asset_ids: list[str]
    operation: AnnotationTagBatchOperation

    _normalize_asset_ids = field_validator("asset_ids")(_normalize_asset_ids)


class AnnotationTagBatchTermSummary(BaseModel):
    name: str
    present_before_count: int
    added_count: int
    removed_count: int


class AnnotationTagBatchEditSummary(BaseModel):
    requested_count: int
    changed_count: int
    unchanged_count: int
    created_or_revived_count: int
    emptied_count: int
    stale_rebound_count: int
    invalidated_tag_translation_count: int
    position_skipped_count: int
    position_clamped_count: int
    terms: list[AnnotationTagBatchTermSummary] = Field(default_factory=list)


class AnnotationTagBatchEditPreviewItem(BaseModel):
    asset_id: str
    filename: str
    relative_path: str
    content_version: str
    changed: bool
    position_skipped: bool
    position_clamped: bool
    before_tags: list[AnnotationTag] = Field(default_factory=list)
    after_tags: list[AnnotationTag] = Field(default_factory=list)
    removed_indices: list[int] = Field(default_factory=list)
    added_indices: list[int] = Field(default_factory=list)


class AnnotationTagBatchEditPreviewPage(BaseModel):
    filter: AnnotationTagBatchDetailFilter
    offset: int
    limit: int
    total: int
    items: list[AnnotationTagBatchEditPreviewItem] = Field(default_factory=list)


class AnnotationTagBatchEditPreview(AnnotationTagBatchEditSummary):
    preview_token: str = Field(pattern=r"^[0-9a-f]{64}$")
    details: AnnotationTagBatchEditPreviewPage


class AnnotationTagBatchEditExecuteRequest(AnnotationTagBatchEditRequest):
    model_config = ConfigDict(extra="forbid")

    preview_token: str = Field(pattern=r"^[0-9a-f]{64}$")


class AnnotationTagBatchEditResult(AnnotationTagBatchEditSummary):
    changed_asset_ids: list[str] = Field(default_factory=list)


class AnnotationBatchOptionsRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    asset_ids: list[str]

    _normalize_asset_ids = field_validator("asset_ids")(_normalize_asset_ids)


class AnnotationBatchTargetRequest(AnnotationBatchOptionsRequest):
    targets: list[AnnotationChannelTarget] = Field(min_length=1)

    _validate_targets = field_validator("targets")(_validate_targets)


class AnnotationBatchDeleteRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    asset_ids: list[str]
    channel: AnnotationChannel | None = None
    language: str | None = None
    translation_source_kind: TranslationSourceKind | None = None
    translation_producer_kind: TranslationProducerKind | None = None
    targets: list[AnnotationChannelTarget] | None = Field(
        default=None,
        min_length=1,
    )

    _normalize_asset_ids = field_validator("asset_ids")(_normalize_asset_ids)
    _validate_target_selection = field_validator("targets")(_validate_optional_targets)

    @model_validator(mode="after")
    def validate_scope(self) -> AnnotationBatchDeleteRequest:
        if self.targets is not None and (
            self.channel is not None
            or self.language
            or self.translation_source_kind is not None
            or self.translation_producer_kind is not None
        ):
            raise ValueError("批量删除不能同时使用单通道参数和多通道范围。")
        return self


class AnnotationBatchReviewRequest(AnnotationBatchOptionsRequest):
    pass


class AnnotationBatchTargetOption(BaseModel):
    channel: AnnotationChannel
    language: str | None = None
    translation_source_kind: TranslationSourceKind | None = None
    translation_producer_kind: TranslationProducerKind | None = None
    display_name: str
    active_count: int
    reviewable_count: int
    reviewed_count: int
    stale_count: int
    blocked_count: int


class AnnotationBatchOptions(BaseModel):
    requested_count: int
    targets: list[AnnotationBatchTargetOption] = Field(default_factory=list)


class AnnotationBatchReviewResult(BaseModel):
    requested_count: int
    target_count: int = 1
    reviewed_count: int
    already_reviewed_count: int
    missing_count: int
    blocked_count: int
    asset_ids: list[str]


class AnnotationBatchDeleteResult(BaseModel):
    requested_count: int
    target_count: int = 0
    deleted_count: int
    missing_count: int
    asset_ids: list[str]


class AnnotationRevision(BaseModel):
    id: str
    document_id: str | None = None
    channel: AnnotationChannel | None = None
    language: str | None = None
    translation_source_kind: TranslationSourceKind | None = None
    translation_producer_kind: TranslationProducerKind | None = None
    source: str
    validation_status: AnnotationStatus
    created_at: str
    content: str = ""
    tags: list[AnnotationTag] = Field(default_factory=list)
    is_tombstone: bool = False
    is_candidate: bool = False
    image_content_hash: str | None = None
    source_job_item_id: str | None = None


class AnnotationWriteResult(BaseModel):
    document: AnnotationDocument
    revision_id: str
    became_head: bool
