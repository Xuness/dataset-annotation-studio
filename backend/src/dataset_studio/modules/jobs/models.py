from __future__ import annotations

from enum import StrEnum

from pydantic import BaseModel, Field


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


class JobCreateRequest(BaseModel):
    provider_profile_id: str
    scope: JobScope = JobScope.ALL
    asset_ids: list[str] = Field(default_factory=list)
    overwrite_existing: bool = False


class JobSummary(BaseModel):
    id: str
    status: JobStatus
    system_preset_id: str
    system_preset_name: str
    provider_profile_id: str
    provider_profile_name: str
    scope: JobScope
    overwrite_existing: bool
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
    preprocessing_count: int = 0
