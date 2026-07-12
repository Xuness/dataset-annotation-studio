from __future__ import annotations

from pydantic import BaseModel, Field


class WorkspaceSettings(BaseModel):
    recursive_scan: bool = True
    user_prompt: str = ""
    json_fields: list[str] = Field(default_factory=list)
    validation_mode: str = "tag_balance"


class WorkspaceManifest(BaseModel):
    schema_version: int = 1
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
    path: str


class WorkspaceSettingsUpdate(BaseModel):
    recursive_scan: bool | None = None
    user_prompt: str | None = None
    json_fields: list[str] | None = None
    validation_mode: str | None = None


class ScanResult(BaseModel):
    scanned_files: int
    indexed_assets: int
    added: int
    updated: int
    missing: int
    duration_ms: int


class WorkspaceOpenResponse(BaseModel):
    workspace: WorkspaceSummary
    scan: ScanResult
