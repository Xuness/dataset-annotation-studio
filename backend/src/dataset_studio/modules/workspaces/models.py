from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class WorkspaceSettings(BaseModel):
    model_config = ConfigDict(extra="forbid")

    recursive_scan: bool = True
    system_preset_id: str | None = None
    user_prompt: str = ""
    json_fields: list[str] = Field(default_factory=list)
    use_confirmed_tags: bool = False
    validation_mode: Literal["tag_balance"] = "tag_balance"


class WorkspaceManifest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    schema_version: Literal[1] = 1
    project_id: str
    name: str
    created_at: str
    settings: WorkspaceSettings = Field(default_factory=WorkspaceSettings)


class WorkspaceSummary(BaseModel):
    project_id: str
    name: str
    root_path: str
    exists: bool = True
    created_at: str
    last_opened_at: str | None = None
    settings: WorkspaceSettings
    asset_count: int = 0
    annotated_count: int = 0
    invalid_count: int = 0


class WorkspaceOpenRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    path: str


class WorkspaceSettingsUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    recursive_scan: bool | None = None
    system_preset_id: str | None = None
    user_prompt: str | None = None
    json_fields: list[str] | None = None
    use_confirmed_tags: bool | None = None
    validation_mode: Literal["tag_balance"] | None = None


class ScanIssue(BaseModel):
    path: str
    message: str


class ScanResult(BaseModel):
    scanned_files: int
    indexed_assets: int
    added: int
    updated: int
    missing: int
    failed: int = 0
    issues: list[ScanIssue] = Field(default_factory=list)
    duration_ms: int


class WorkspaceOpenResponse(BaseModel):
    workspace: WorkspaceSummary
    scan: ScanResult
