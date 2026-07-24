from __future__ import annotations

from enum import StrEnum

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from dataset_studio.modules.annotations.models import AnnotationChannel


def _require_non_blank(value: str | None) -> str | None:
    if value is not None and not value.strip():
        raise ValueError("内容不能只包含空白字符。")
    return value


class JobStatus(StrEnum):
    QUEUED = "queued"
    RUNNING = "running"
    STOPPING = "stopping"
    STOPPED = "stopped"
    INTERRUPTED = "interrupted"
    COMPLETED = "completed"
    COMPLETED_WITH_ERRORS = "completed_with_errors"


class JobItemStatus(StrEnum):
    PENDING = "pending"
    RUNNING = "running"
    SUCCEEDED = "succeeded"
    FAILED = "failed"
    INTERRUPTED = "interrupted"
    SKIPPED = "skipped"
    MANUALLY_ACCEPTED = "manually_accepted"


class JobScope(StrEnum):
    ALL = "all"
    SELECTED = "selected"


class JobKind(StrEnum):
    ANNOTATION = "annotation"
    TRANSLATION = "translation"


class ExecutionBackend(StrEnum):
    PROVIDER = "provider"
    LOCAL_TAGGER = "local_tagger"


class ExistingTranslationPolicy(StrEnum):
    SKIP = "skip"
    STALE = "stale"
    OVERWRITE = "overwrite"


class JobCreateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    execution_backend: ExecutionBackend = ExecutionBackend.PROVIDER
    provider_profile_id: str | None = None
    model_id: str | None = Field(default=None, min_length=1, max_length=500)
    tagger_profile_id: str | None = None
    kind: JobKind = JobKind.ANNOTATION
    scope: JobScope = JobScope.ALL
    asset_ids: list[str] = Field(default_factory=list)
    overwrite_existing: bool = False
    translation_prompt_preset_id: str | None = None
    target_language: str = "zh-CN"
    translation_policy: ExistingTranslationPolicy = ExistingTranslationPolicy.SKIP

    _validate_model = field_validator("model_id")(_require_non_blank)

    @model_validator(mode="after")
    def validate_execution_backend(self) -> JobCreateRequest:
        if self.kind == JobKind.TRANSLATION and self.execution_backend != ExecutionBackend.PROVIDER:
            raise ValueError("翻译任务只能使用 LLM 模型连接。")
        if self.execution_backend == ExecutionBackend.PROVIDER:
            if not self.provider_profile_id or not self.provider_profile_id.strip():
                raise ValueError("请选择模型连接。")
        elif not self.tagger_profile_id or not self.tagger_profile_id.strip():
            raise ValueError("请选择本地打标配置。")
        return self


class JobSummary(BaseModel):
    id: str
    status: JobStatus
    kind: JobKind = JobKind.ANNOTATION
    execution_backend: ExecutionBackend = ExecutionBackend.PROVIDER
    execution_profile_id: str
    execution_profile_name: str
    system_preset_id: str | None
    system_preset_name: str | None
    provider_profile_id: str | None
    provider_profile_name: str | None
    model: str
    scope: JobScope
    overwrite_existing: bool
    output_channel: AnnotationChannel
    use_confirmed_tags: bool = False
    target_language: str | None = None
    translation_policy: ExistingTranslationPolicy | None = None
    retry_limit: int
    total: int = 0
    pending: int = 0
    running: int = 0
    succeeded: int = 0
    failed: int = 0
    skipped: int = 0
    manually_accepted: int = 0
    created_at: str
    updated_at: str
    completed_at: str | None = None


class JobAttempt(BaseModel):
    id: str
    attempt_number: int
    status: str
    response_content: str | None = None
    error_message: str | None = None
    started_at: str
    finished_at: str | None = None
    input_tokens: int | None = None
    output_tokens: int | None = None
    cache_read_tokens: int | None = None
    cache_write_tokens: int | None = None
    reasoning_tokens: int | None = None
    finish_reason: str | None = None


class JobItemDetail(BaseModel):
    id: str
    asset_id: str
    relative_path: str
    status: JobItemStatus
    attempt_count: int
    last_error: str | None = None
    validation_status: str | None = None
    manually_accepted: bool = False
    attempts: list[JobAttempt] = Field(default_factory=list)


class JobDetail(JobSummary):
    items: list[JobItemDetail] = Field(default_factory=list)


class ActiveJobsOverview(BaseModel):
    count: int
    project_count: int
    annotation_job_count: int = 0
    translation_job_count: int = 0
    preprocessing_count: int = 0
    export_count: int = 0
    asset_deletion_count: int = 0
    tagger_download_count: int = 0
