from __future__ import annotations

from enum import StrEnum

from pydantic import AliasChoices, BaseModel, ConfigDict, Field, field_validator, model_validator

from dataset_studio.core.languages import normalize_language_code


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

    @model_validator(mode="after")
    def validate_language(self) -> AnnotationChannelTarget:
        if self.channel == AnnotationChannel.TRANSLATION:
            if not self.language:
                raise ValueError("翻译标注通道必须指定语言。")
            try:
                self.language = normalize_language_code(self.language)
            except ValueError as error:
                raise ValueError("翻译标注通道的语言代码无效。") from error
        elif self.language:
            raise ValueError("只有翻译标注通道可以指定语言。")
        return self

    @property
    def key(self) -> str:
        return f"{self.channel.value}:{self.language}" if self.language else self.channel.value


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
    targets: list[AnnotationChannelTarget] | None = Field(
        default=None,
        min_length=1,
    )

    _normalize_asset_ids = field_validator("asset_ids")(_normalize_asset_ids)
    _validate_target_selection = field_validator("targets")(_validate_optional_targets)

    @model_validator(mode="after")
    def validate_scope(self) -> AnnotationBatchDeleteRequest:
        if self.targets is not None and (self.channel is not None or self.language):
            raise ValueError("批量删除不能同时使用单通道参数和多通道范围。")
        return self


class AnnotationBatchReviewRequest(AnnotationBatchOptionsRequest):
    pass


class AnnotationBatchTargetOption(BaseModel):
    channel: AnnotationChannel
    language: str | None = None
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
