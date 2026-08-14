from __future__ import annotations

from enum import StrEnum
from typing import Literal

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, field_validator

SCORE_VERSION = "metarank-batch-v0.1"
SCORE_MODE = "batch_only_v0_1"
CHARACTER_LORA_PROFILE_VERSION = "character-lora-v1"
SELECTION_POLICY_VERSION = "selection-policy-v1"


class ScreeningOperationStatus(StrEnum):
    QUEUED = "queued"
    RUNNING = "running"
    STOPPING = "stopping"
    STOPPED = "stopped"
    INTERRUPTED = "interrupted"
    COMPLETED = "completed"
    FAILED = "failed"


class ScreeningTaskProfile(StrEnum):
    CHARACTER_LORA = "character_lora"
    GENERAL_AESTHETIC = "general_aesthetic"
    STYLE_LORA = "style_lora"


class ScreeningIntensity(StrEnum):
    CONSERVATIVE = "conservative"
    BALANCED = "balanced"
    AGGRESSIVE = "aggressive"


class ScreeningCandidatePool(StrEnum):
    ELITE = "elite_candidate"
    RECOMMENDED = "recommended"
    LOW_EVIDENCE = "low_evidence_protected"
    REVIEW = "review"
    TASK_MISMATCH = "task_mismatch"
    LOW_PRIORITY = "low_priority_high_confidence"
    QUARANTINE = "quarantine"
    INVALID = "invalid"


class CharacterLoraRules(BaseModel):
    model_config = ConfigDict(extra="forbid")

    comic_panel: bool = True
    multiple_views: bool = True
    monochrome_greyscale: bool = True
    lineart_sketch: bool = True
    crowd_3plus: bool = True


class ScreeningTaskProfileSelection(BaseModel):
    model_config = ConfigDict(extra="forbid")

    task_profile: Literal[ScreeningTaskProfile.CHARACTER_LORA] = ScreeningTaskProfile.CHARACTER_LORA
    task_rules: CharacterLoraRules = Field(default_factory=CharacterLoraRules)


class ScreeningTaskProfileSnapshot(BaseModel):
    profile_id: Literal[ScreeningTaskProfile.CHARACTER_LORA]
    profile_version: str
    rules: CharacterLoraRules
    fit_factors: dict[str, float]
    selection_policy_version: str = SELECTION_POLICY_VERSION


class ScreeningRequest(ScreeningTaskProfileSelection):
    asset_ids: list[str] = Field(min_length=1, max_length=100_000)
    intensity: ScreeningIntensity = ScreeningIntensity.BALANCED
    metadata_snapshot_at: AwareDatetime | None = None

    @field_validator("asset_ids")
    @classmethod
    def normalize_asset_ids(cls, value: list[str]) -> list[str]:
        normalized = list(dict.fromkeys(asset_id.strip() for asset_id in value if asset_id.strip()))
        if not normalized:
            raise ValueError("请至少选择一张要筛选的图片。")
        return normalized


class ScreeningPreview(BaseModel):
    requested_count: int
    available_count: int
    metadata_available_count: int
    metadata_missing_count: int
    missing_asset_ids: list[str] = Field(default_factory=list)


class ScreeningOperation(BaseModel):
    id: str
    status: ScreeningOperationStatus
    score_mode: str
    score_version: str
    total_items: int
    processed_items: int
    scored_items: int
    invalid_items: int
    current_relative_path: str | None = None
    configuration_snapshot: dict[str, object] = Field(default_factory=dict)
    task_profile_snapshot: ScreeningTaskProfileSnapshot | None = None
    task_evaluated_items: int = 0
    task_unavailable_items: int = 0
    task_profile_updated_at: str | None = None
    pool_counts: dict[str, int] = Field(default_factory=dict)
    rating_counts: dict[str, int] = Field(default_factory=dict)
    created_at: str
    updated_at: str
    started_at: str | None = None
    completed_at: str | None = None
    error_message: str | None = None

    @property
    def active(self) -> bool:
        return self.status in {
            ScreeningOperationStatus.QUEUED,
            ScreeningOperationStatus.RUNNING,
            ScreeningOperationStatus.STOPPING,
        }


class ScreeningScoreDetails(BaseModel):
    popularity_percentile_raw: float
    popularity_percentile_final: float
    depth_percentile_raw: float
    depth_percentile_final: float
    vote_posterior_mean: float | None = None
    vote_posterior_lower_95: float | None = None
    vote_percentile_mean: float | None = None
    vote_percentile_lower: float | None = None
    vote_keep_signal: float
    bad_pop: float
    bad_depth: float
    bad_vote: float
    bad_consensus_second: float


class ScreeningCandidateElsewhere(BaseModel):
    asset_id: str
    source_relative_path: str
    match_kind: Literal["danbooru_post", "content_hash"]


class ScreeningItem(BaseModel):
    asset_id: str
    source_relative_path: str
    image_width: int | None = None
    image_height: int | None = None
    metadata_relative_path: str | None = None
    status: Literal["pending", "parsed", "scored", "invalid"]
    rating: str | None = None
    created_at: str | None = None
    metadata_snapshot_at: str | None = None
    age_hours: float | None = None
    age_bucket: str | None = None
    fav_count: int | None = None
    up_score: int | None = None
    downvote_count: int | None = None
    evidence_mass: int | None = None
    confidence_pop: float | None = None
    confidence_depth: float | None = None
    confidence_vote: float | None = None
    technical_score: float | None = None
    keep_score: float | None = None
    elite_score: float | None = None
    final_score: float | None = None
    rating_rank: int | None = None
    rating_percentile: float | None = None
    task_fit_score: float | None = None
    selection_score: float | None = None
    selection_rank: int | None = None
    selection_percentile: float | None = None
    task_reason_codes: list[str] = Field(default_factory=list)
    task_matched_tags: list[str] = Field(default_factory=list)
    quality_candidate_pool: ScreeningCandidatePool | None = None
    candidate_pool: ScreeningCandidatePool | None = None
    low_resolution_flag: bool = False
    pixel_duplicate_group: str | None = None
    variant_group: str | None = None
    duplicate_representative: bool = True
    duplicate_of_asset_id: str | None = None
    source_post_id: str | None = None
    is_candidate: bool = False
    candidate_elsewhere: list[ScreeningCandidateElsewhere] = Field(default_factory=list)
    score_details: ScreeningScoreDetails | None = None
    reason_codes: list[str] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
    error_code: str | None = None
    error_message: str | None = None


class ScreeningItemList(BaseModel):
    items: list[ScreeningItem]
    total: int
    offset: int
    limit: int


class ScreeningAssetIds(BaseModel):
    ids: list[str]
    total: int


class ScreeningCapabilities(BaseModel):
    score_mode: str = SCORE_MODE
    score_version: str = SCORE_VERSION
    max_assets_per_operation: int = 100_000
    task_profiles: list[ScreeningTaskProfile] = Field(
        default_factory=lambda: [ScreeningTaskProfile.CHARACTER_LORA]
    )
    task_profile_versions: dict[str, str] = Field(
        default_factory=lambda: {
            ScreeningTaskProfile.CHARACTER_LORA.value: CHARACTER_LORA_PROFILE_VERSION
        }
    )
    selection_policy_version: str = SELECTION_POLICY_VERSION
    intensities: list[ScreeningIntensity] = Field(default_factory=lambda: list(ScreeningIntensity))
    candidate_pools: list[ScreeningCandidatePool] = Field(
        default_factory=lambda: list(ScreeningCandidatePool)
    )
    batch_local_only: bool = True
    reads_global_archive: bool = False
    modifies_assets: bool = False
    enabled_signals: list[str] = Field(
        default_factory=lambda: [
            "batch_rating_popularity",
            "batch_rating_up_bucket_favorite_depth",
            "batch_rating_vote_posterior_mean",
            "stored_image_dimensions",
        ]
    )
    disabled_signals: list[str] = Field(
        default_factory=lambda: [
            "global_archive_cdf",
            "character_copyright_debias",
            "artist_rescue",
            "beta_lower_bound",
            "historical_trend",
        ]
    )
