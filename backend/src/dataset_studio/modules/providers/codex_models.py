from __future__ import annotations

from enum import StrEnum

from pydantic import BaseModel


class CodexAccountStatus(BaseModel):
    logged_in: bool
    uses_chatgpt: bool
    account_type: str | None = None
    email: str | None = None
    plan_type: str | None = None
    requires_openai_auth: bool = True


class CodexLoginState(StrEnum):
    PENDING = "pending"
    SUCCEEDED = "succeeded"
    FAILED = "failed"
    CANCELLED = "cancelled"


class CodexLoginStart(BaseModel):
    login_id: str
    auth_url: str


class CodexLoginStatus(BaseModel):
    login_id: str
    state: CodexLoginState
    error: str | None = None
