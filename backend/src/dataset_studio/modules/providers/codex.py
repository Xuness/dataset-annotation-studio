from __future__ import annotations

import asyncio
from contextlib import suppress
from enum import Enum
from typing import Any

from openai_codex import ApprovalMode, LocalImageInput, Sandbox, TextInput

from dataset_studio.modules.presets.models import ProviderProfile
from dataset_studio.modules.providers.codex_runtime import CodexRuntime
from dataset_studio.modules.providers.models import (
    MultimodalRequest,
    ProviderRequestError,
    ProviderResponse,
)
from dataset_studio.modules.providers.reasoning import extract_codex_reasoning

_ANNOTATION_CONFIG: dict[str, object] = {
    "web_search": "disabled",
    "project_doc_max_bytes": 0,
    "features": {
        "multi_agent": False,
        "shell_tool": False,
    },
}


class CodexProvider:
    def __init__(self, runtime: CodexRuntime) -> None:
        self._runtime = runtime

    async def complete(
        self,
        profile: ProviderProfile,
        _credential: str | None,
        request: MultimodalRequest,
    ) -> ProviderResponse:
        await self._runtime.require_chatgpt_account()
        client = await self._runtime.client()
        requested_effort = (
            profile.request_options.reasoning_effort.value
            if profile.request_options.reasoning_effort is not None
            else None
        )
        effort = await self._runtime.resolve_reasoning_effort(request.model, requested_effort)
        handle: Any | None = None
        try:
            async with asyncio.timeout(request.timeout_seconds):
                thread = await client.thread_start(
                    approval_mode=ApprovalMode.deny_all,
                    config=_ANNOTATION_CONFIG,
                    cwd=str(self._runtime.working_directory()),
                    developer_instructions=request.system_prompt,
                    ephemeral=True,
                    model=request.model,
                    sandbox=Sandbox.read_only,
                )
                handle = await thread.turn(
                    [
                        TextInput(text=request.user_prompt),
                        LocalImageInput(path=str(request.image_path.resolve())),
                    ],
                    effort=effort,
                )
                result = await handle.run()
        except TimeoutError as error:
            _interrupt_in_background(handle)
            raise ProviderRequestError(
                f"Codex 请求超过 {request.timeout_seconds} 秒，已中断。"
            ) from error
        except asyncio.CancelledError:
            _interrupt_in_background(handle)
            raise
        except ProviderRequestError:
            raise
        except Exception as error:
            raise ProviderRequestError(f"Codex 请求失败：{error}") from error

        raw_items = [_model_dump(item) for item in result.items]
        raw_payload = {
            "provider": "codex",
            "thread_id": thread.id,
            "turn_id": result.id,
            "status": _enum_value(result.status),
            "error": _model_dump(result.error),
            "items": raw_items,
            "usage": _model_dump(result.usage),
        }
        if result.error is not None:
            raise ProviderRequestError(
                f"Codex 未能完成请求：{_error_message(result.error)}",
                response_text=result.final_response,
            )
        if result.final_response is None or not result.final_response.strip():
            raise ProviderRequestError("Codex 没有返回最终标注内容。")

        last_usage = getattr(result.usage, "last", None) if result.usage is not None else None
        return ProviderResponse(
            content=result.final_response,
            raw_payload=raw_payload,
            reasoning_content=extract_codex_reasoning(raw_items),
            finish_reason=_enum_value(result.status),
            input_tokens=getattr(last_usage, "input_tokens", None),
            output_tokens=getattr(last_usage, "output_tokens", None),
            cache_read_tokens=getattr(last_usage, "cached_input_tokens", None),
            reasoning_tokens=getattr(last_usage, "reasoning_output_tokens", None),
        )


def _interrupt_in_background(handle: Any | None) -> None:
    if handle is None:
        return
    task = asyncio.create_task(handle.interrupt())
    task.add_done_callback(_consume_task_result)


def _consume_task_result(task: asyncio.Task[Any]) -> None:
    with suppress(asyncio.CancelledError, Exception):
        task.result()


def _enum_value(value: object) -> str | None:
    if value is None:
        return None
    if isinstance(value, Enum):
        return str(value.value)
    return str(value)


def _model_dump(value: object) -> object:
    if value is None:
        return None
    model_dump = getattr(value, "model_dump", None)
    if callable(model_dump):
        return model_dump(mode="json", by_alias=True)
    if isinstance(value, (str, int, float, bool, list, dict)):
        return value
    return str(value)


def _error_message(error: object) -> str:
    message = getattr(error, "message", None)
    return str(message or error)
