from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from dataset_studio.modules.annotations.models import AnnotationTag
from dataset_studio.modules.providers.config import ProviderExecutionProfile
from dataset_studio.modules.providers.models import ProviderResponse
from dataset_studio.modules.tag_dictionaries.models import normalize_tag_key

AuditStatus = Literal[
    "draft",
    "preparing",
    "queued",
    "running",
    "stopping",
    "stopped",
    "interrupted",
    "failed",
    "review",
    "applied",
]
AuditStage = Literal["text", "visual", "resolution"]
Decision = Literal["keep", "delete", "replace", "uncertain"]
Category = Literal[
    "identity",
    "hair",
    "eyes",
    "face",
    "body",
    "clothing",
    "footwear",
    "legwear",
    "accessory",
    "action",
    "pose",
    "expression",
    "scene",
    "composition",
    "quality",
    "object",
    "other",
]
ACTIVE_STATUSES = ("preparing", "queued", "running", "stopping")


class AuditModel(BaseModel):
    model_config = ConfigDict(extra="ignore", frozen=True, strict=True)


class CharacterProfile(AuditModel):
    trigger: str = Field(min_length=1, max_length=500)
    reference_asset_id: str = Field(min_length=1)
    membership: Literal["trigger", "directory"]
    directory: str | None
    subject: Literal["girl", "boy", "unknown"]

    @field_validator("trigger")
    @classmethod
    def valid_trigger(cls, value: str) -> str:
        value = value.strip()
        if not value or any(char in value for char in ",\r\n\x00"):
            raise ValueError("角色触发词必须是一个非空标签，不能包含逗号或控制字符。")
        return value

    @model_validator(mode="after")
    def valid_membership(self) -> CharacterProfile:
        if self.membership == "directory" and self.directory is None:
            raise ValueError("按目录归属时必须指定目录；空字符串表示项目根目录。")
        if self.directory is not None:
            parts = self.directory.split("/")
            if ".." in parts or "\\" in self.directory or self.directory.startswith("/"):
                raise ValueError("角色目录必须是项目内的相对路径。")
        return self


class AuditCreateRequest(AuditModel):
    scope: Literal["all", "directory", "selected"]
    directory: str | None
    asset_ids: list[str]
    profiles: list[CharacterProfile] = Field(min_length=1, max_length=4)
    style: Literal["sparse", "full"]
    minimum_count: int = Field(ge=1)
    provider_profile_id: str = Field(min_length=1)
    model_id: str = Field(min_length=1)
    vocabulary_id: str = Field(pattern=r"^[a-f0-9]{64}$")
    retry_limit: int = Field(ge=0, le=5)

    @model_validator(mode="after")
    def valid_scope(self) -> AuditCreateRequest:
        triggers = [normalize_tag_key(profile.trigger) for profile in self.profiles]
        if len(set(triggers)) != len(triggers):
            raise ValueError("每个角色必须使用不同的触发词。")
        if self.scope == "selected" and not self.asset_ids:
            raise ValueError("选中素材范围不能为空。")
        if self.scope == "directory" and self.directory is None:
            raise ValueError("目录范围必须指定项目相对目录。")
        if self.directory is not None and (
            ".." in self.directory.split("/")
            or "\\" in self.directory
            or self.directory.startswith("/")
        ):
            raise ValueError("审查目录必须是项目内的相对路径。")
        return self


class AssetSnapshot(AuditModel):
    asset_id: str
    relative_path: str
    image_hash: str
    revision_id: str | None
    tags: list[AnnotationTag]
    usable: bool
    candidate_count: int


class InventoryTag(AuditModel):
    tag: str
    count: int
    category: Category
    cluster: int | None


class TagDecision(AuditModel):
    tag: str = Field(min_length=1)
    decision: Decision
    category: Category
    reason: str = Field(min_length=1)
    replacement: str | None
    include_in_prompt: bool
    prompt_order: int = Field(ge=0)


class ModelAnswer(AuditModel):
    items: list[TagDecision]


class ProfileReview(AuditModel):
    profile_index: int
    inventory: list[InventoryTag]
    excluded: list[InventoryTag]
    initial: list[TagDecision]
    suggested: list[TagDecision]
    decisions: list[TagDecision]
    completed_stages: list[AuditStage]
    prompt: str
    confirmed: bool


class ConflictResolution(AuditModel):
    asset_id: str
    tag: str
    decision: Literal["keep", "replace"]
    replacement: str | None
    reason: str = Field(min_length=1)


class AuditAttempt(AuditModel):
    id: str
    profile_index: int
    stage: AuditStage
    attempt: int
    status: Literal["running", "succeeded", "failed", "interrupted"]
    started_at: str
    finished_at: str | None
    request_system: str
    request_user: str
    response: ProviderResponse | None
    error: str | None


class AuditOperation(AuditModel):
    id: str
    status: AuditStatus
    version: int
    created_at: str
    updated_at: str
    request: AuditCreateRequest
    provider: ProviderExecutionProfile
    source_assets: list[AssetSnapshot]
    references: list[AssetSnapshot]
    reviews: list[ProfileReview]
    resolutions: list[ConflictResolution]
    attempts: list[AuditAttempt]
    prerequisite_job_id: str | None
    error: str | None
    applied_token: str | None
    applied_revision_ids: list[str]


class AuditSummary(AuditModel):
    id: str
    status: AuditStatus
    version: int
    triggers: list[str]
    created_at: str
    updated_at: str
    error: str | None


class MembershipPreview(AuditModel):
    total: int
    member_counts: list[int]
    shared_count: int
    unattributed_count: int
    missing_tags_count: int
    candidate_count: int


class ReviewUpdate(AuditModel):
    version: int
    decisions: list[TagDecision]


class ResolutionsUpdate(AuditModel):
    version: int
    resolutions: list[ConflictResolution]


class VersionRequest(AuditModel):
    version: int


class PrepareTagsRequest(AuditModel):
    version: int
    tagger_profile_id: str
    overwrite_existing: bool


class ApplyRequest(AuditModel):
    preview_token: str


class TagConflict(AuditModel):
    asset_id: str
    tag: str
    proposals: list[TagDecision]
    resolution: ConflictResolution | None


class AssetChange(AuditModel):
    asset_id: str
    relative_path: str
    before: list[AnnotationTag]
    after: list[AnnotationTag]


class ApplyPreview(AuditModel):
    preview_token: str
    changed_count: int
    changes: list[AssetChange]
    conflicts: list[TagConflict]
    membership: MembershipPreview


class VocabularyImport(AuditModel):
    directory: str = Field(min_length=1)
    source_version: str = Field(min_length=1)
    license_acknowledged: Literal[True]


class VocabularyManifest(AuditModel):
    id: str
    source_url: str
    source_version: str
    license_status: Literal["mixed"]
    acknowledged_at: str
    character_count: int
    general_count: int
    relation_count: int
    database_sha256: str


class VocabularyLibrary(AuditModel):
    installations: list[VocabularyManifest]
    issues: list[str]
