from __future__ import annotations

import asyncio
from collections.abc import Callable
from contextlib import suppress
from dataclasses import dataclass
from enum import Enum
from pathlib import Path
from tempfile import TemporaryDirectory
from time import monotonic
from typing import Any

from openai_codex import AsyncCodex

from dataset_studio.modules.providers.codex_models import (
    CodexAccountStatus,
    CodexLoginStart,
    CodexLoginState,
    CodexLoginStatus,
)
from dataset_studio.modules.providers.config import ReasoningEffort
from dataset_studio.modules.providers.models import ProviderModelSummary, ProviderRequestError

_LOGIN_RETENTION_SECONDS = 15 * 60
_ANNOTATION_REASONING_EFFORTS = frozenset(effort.value for effort in ReasoningEffort)


def _default_client_factory() -> AsyncCodex:
    return AsyncCodex()


@dataclass(slots=True)
class _LoginAttempt:
    handle: Any
    task: asyncio.Task[Any]
    auth_url: str
    created_at: float


class CodexRuntime:
    """Own a lazily started Codex app-server and its ChatGPT login flows."""

    def __init__(
        self,
        client_factory: Callable[[], AsyncCodex] = _default_client_factory,
    ) -> None:
        self._client_factory = client_factory
        self._client: AsyncCodex | None = None
        self._client_lock = asyncio.Lock()
        self._login_lock = asyncio.Lock()
        self._login_attempts: dict[str, _LoginAttempt] = {}
        self._models: list[Any] | None = None
        self._models_lock = asyncio.Lock()
        self._working_directory: TemporaryDirectory[str] | None = None

    def working_directory(self) -> Path:
        """Return the empty sandbox root shared by ephemeral annotation threads."""
        if self._working_directory is None:
            self._working_directory = TemporaryDirectory(prefix="dataset-studio-codex-")
        return Path(self._working_directory.name).resolve()

    async def client(self) -> AsyncCodex:
        if self._client is not None:
            return self._client
        async with self._client_lock:
            if self._client is not None:
                return self._client
            client = self._client_factory()
            try:
                await client.__aenter__()
            except Exception as error:
                with suppress(Exception):
                    await client.close()
                raise ProviderRequestError(f"无法启动 Codex 本地运行时：{error}") from error
            self._client = client
            return client

    async def close(self) -> None:
        self._models = None
        async with self._login_lock:
            attempts = list(self._login_attempts.values())
            self._login_attempts.clear()
        for attempt in attempts:
            if not attempt.task.done():
                with suppress(Exception):
                    await attempt.handle.cancel()
                attempt.task.cancel()
        if attempts:
            await asyncio.gather(*(attempt.task for attempt in attempts), return_exceptions=True)

        async with self._client_lock:
            client, self._client = self._client, None
        if client is not None:
            with suppress(Exception):
                await client.close()

        working_directory, self._working_directory = self._working_directory, None
        if working_directory is not None:
            with suppress(Exception):
                working_directory.cleanup()

    async def account_status(self) -> CodexAccountStatus:
        client = await self.client()
        try:
            response = await client.account()
        except Exception as error:
            raise ProviderRequestError(f"无法读取 Codex 登录状态：{error}") from error
        account = response.account
        account_value = getattr(account, "root", account) if account is not None else None
        account_type = _enum_value(getattr(account_value, "type", None)) if account_value else None
        return CodexAccountStatus(
            logged_in=account is not None,
            uses_chatgpt=account_type == "chatgpt",
            account_type=account_type,
            email=_optional_text(getattr(account_value, "email", None)) if account_value else None,
            plan_type=(
                _enum_value(getattr(account_value, "plan_type", None)) if account_value else None
            ),
            requires_openai_auth=bool(response.requires_openai_auth),
        )

    async def require_chatgpt_account(self) -> CodexAccountStatus:
        status = await self.account_status()
        if not status.logged_in:
            raise ProviderRequestError("Codex 尚未登录，请先在 API 配置页使用 ChatGPT 登录。")
        if not status.uses_chatgpt:
            raise ProviderRequestError(
                "当前 Codex 使用的不是 ChatGPT 登录，无法使用订阅额度；请重新使用 ChatGPT 登录。"
            )
        return status

    async def start_chatgpt_login(self) -> CodexLoginStart:
        client = await self.client()
        async with self._login_lock:
            self._prune_login_attempts()
            for login_id, attempt in self._login_attempts.items():
                if not attempt.task.done():
                    return CodexLoginStart(login_id=login_id, auth_url=attempt.auth_url)
            try:
                handle = await client.login_chatgpt()
            except Exception as error:
                raise ProviderRequestError(f"无法启动 Codex ChatGPT 登录：{error}") from error
            task = asyncio.create_task(handle.wait(), name=f"codex-login-{handle.login_id}")
            self._login_attempts[handle.login_id] = _LoginAttempt(
                handle=handle,
                task=task,
                auth_url=handle.auth_url,
                created_at=monotonic(),
            )
            return CodexLoginStart(login_id=handle.login_id, auth_url=handle.auth_url)

    async def login_status(self, login_id: str) -> CodexLoginStatus:
        async with self._login_lock:
            self._prune_login_attempts()
            attempt = self._login_attempts.get(login_id)
            if attempt is None:
                raise ValueError("找不到这个 Codex 登录会话，可能已经过期。")
            if not attempt.task.done():
                return CodexLoginStatus(login_id=login_id, state=CodexLoginState.PENDING)
            if attempt.task.cancelled():
                return CodexLoginStatus(login_id=login_id, state=CodexLoginState.CANCELLED)
            try:
                result = attempt.task.result()
            except Exception as error:
                return CodexLoginStatus(
                    login_id=login_id,
                    state=CodexLoginState.FAILED,
                    error=str(error) or type(error).__name__,
                )
            if result.success:
                self._models = None
                return CodexLoginStatus(login_id=login_id, state=CodexLoginState.SUCCEEDED)
            return CodexLoginStatus(
                login_id=login_id,
                state=CodexLoginState.FAILED,
                error=result.error or "ChatGPT 登录没有成功完成。",
            )

    async def cancel_login(self, login_id: str) -> CodexLoginStatus:
        async with self._login_lock:
            attempt = self._login_attempts.get(login_id)
            if attempt is None:
                raise ValueError("找不到这个 Codex 登录会话，可能已经过期。")
            if not attempt.task.done():
                with suppress(Exception):
                    await attempt.handle.cancel()
                attempt.task.cancel()
        if not attempt.task.done():
            await asyncio.gather(attempt.task, return_exceptions=True)
        return CodexLoginStatus(login_id=login_id, state=CodexLoginState.CANCELLED)

    async def search_models(self, query: str, limit: int) -> list[ProviderModelSummary]:
        await self.require_chatgpt_account()
        normalized_query = query.strip().casefold()
        models: list[ProviderModelSummary] = []
        for model in await self._model_catalog():
            modalities = [_enum_value(value) for value in model.input_modalities]
            model_id = str(model.model or model.id)
            display_name = str(model.display_name or model_id)
            description = str(model.description or "")
            if (
                normalized_query
                and normalized_query
                not in " ".join((model_id, display_name, description)).casefold()
            ):
                continue
            reasoning_efforts = [
                value
                for option in model.supported_reasoning_efforts
                if (value := _enum_value(option.reasoning_effort)) in _ANNOTATION_REASONING_EFFORTS
            ]
            models.append(
                ProviderModelSummary(
                    id=model_id,
                    name=display_name,
                    description=description,
                    input_modalities=modalities,
                    supported_parameters=["reasoning_effort"] if reasoning_efforts else [],
                    reasoning_efforts=reasoning_efforts,
                    capabilities_known=True,
                )
            )
            if len(models) >= limit:
                break
        return models

    async def resolve_reasoning_effort(
        self,
        model_id: str,
        requested_effort: str | None,
    ) -> str | None:
        for model in await self._model_catalog():
            if model_id not in {str(model.model), str(model.id)}:
                continue
            supported = {
                value
                for option in model.supported_reasoning_efforts
                if (value := _enum_value(option.reasoning_effort)) in _ANNOTATION_REASONING_EFFORTS
            }
            if requested_effort is not None and requested_effort not in supported:
                choices = "、".join(sorted(supported)) or "模型默认"
                raise ProviderRequestError(
                    f"Codex 模型 {model_id} 不支持推理强度 {requested_effort}；可用值：{choices}。"
                )
            if requested_effort is not None:
                return requested_effort
            return _enum_value(model.default_reasoning_effort)
        return requested_effort

    async def _model_catalog(self) -> list[Any]:
        if self._models is not None:
            return self._models
        async with self._models_lock:
            if self._models is not None:
                return self._models
            client = await self.client()
            try:
                response = await client.models()
            except Exception as error:
                raise ProviderRequestError(f"无法读取 Codex 模型目录：{error}") from error
            self._models = list(response.data)
            return self._models

    def _prune_login_attempts(self) -> None:
        now = monotonic()
        expired = [
            login_id
            for login_id, attempt in self._login_attempts.items()
            if attempt.task.done() and now - attempt.created_at >= _LOGIN_RETENTION_SECONDS
        ]
        for login_id in expired:
            self._login_attempts.pop(login_id, None)


def _enum_value(value: object) -> str:
    if isinstance(value, Enum):
        return str(value.value)
    return str(value) if value is not None else ""


def _optional_text(value: object) -> str | None:
    return str(value) if value is not None else None
