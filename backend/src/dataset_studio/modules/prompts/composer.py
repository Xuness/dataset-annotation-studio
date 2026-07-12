from __future__ import annotations

import json
from collections.abc import Iterable

from pydantic import BaseModel


class PromptPreview(BaseModel):
    user_prompt: str
    metadata_lines: list[str]
    final_prompt: str


def _resolve_path(document: object, path: str) -> tuple[bool, object | None]:
    current = document
    for segment in path.split("."):
        if not isinstance(current, dict) or segment not in current:
            return False, None
        current = current[segment]
    return True, current


def _format_value(value: object) -> str:
    if isinstance(value, str):
        return value
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (dict, list)):
        return json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    return str(value)


def compose_user_prompt(
    user_prompt: str,
    metadata: object | None,
    selected_fields: Iterable[str],
) -> str:
    lines: list[str] = []
    if metadata is not None:
        for field in selected_fields:
            found, value = _resolve_path(metadata, field)
            if found:
                lines.append(f"{field}: {_format_value(value)}")

    body = user_prompt.rstrip()
    if not lines:
        return body
    if not body:
        return "\n".join(lines)
    return f"{body}\n\n" + "\n".join(lines)


def preview_user_prompt(
    user_prompt: str,
    metadata: object | None,
    selected_fields: Iterable[str],
) -> PromptPreview:
    final_prompt = compose_user_prompt(user_prompt, metadata, selected_fields)
    body = user_prompt.rstrip()
    metadata_text = final_prompt[len(body) :].lstrip("\n") if body else final_prompt
    return PromptPreview(
        user_prompt=body,
        metadata_lines=metadata_text.splitlines() if metadata_text else [],
        final_prompt=final_prompt,
    )
