from __future__ import annotations

import json
from collections.abc import Iterable

from pydantic import BaseModel


class PromptPreview(BaseModel):
    user_prompt: str
    metadata_lines: list[str]
    final_prompt: str


class RequestPromptPreview(BaseModel):
    """The two text messages sent with an image in a multimodal request."""

    system_preset_id: str | None
    system_preset_name: str | None
    system_prompt: str
    user_prompt: str
    metadata_lines: list[str]
    final_user_prompt: str
    configuration_issue: str | None = None


def escape_metadata_path_segment(segment: object) -> str:
    return str(segment).replace("\\", "\\\\").replace(".", "\\.")


def _split_path(path: str) -> list[str]:
    segments: list[str] = []
    current: list[str] = []
    escaped = False
    for character in path:
        if escaped:
            current.append(character)
            escaped = False
        elif character == "\\":
            escaped = True
        elif character == ".":
            segments.append("".join(current))
            current = []
        else:
            current.append(character)
    if escaped:
        current.append("\\")
    segments.append("".join(current))
    return segments


def _resolve_path(document: object, path: str) -> tuple[bool, object | None]:
    def resolve(segments: list[str]) -> tuple[bool, object | None]:
        current = document
        for segment in segments:
            if not isinstance(current, dict) or segment not in current:
                return False, None
            current = current[segment]
        return True, current

    found, value = resolve(_split_path(path))
    if found or "\\" not in path:
        return found, value
    # Manifests created before escaping support treated backslashes literally.
    return resolve(path.split("."))


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
    auxiliary_tags: Iterable[str] = (),
) -> str:
    lines: list[str] = []
    if metadata is not None:
        for field in selected_fields:
            found, value = _resolve_path(metadata, field)
            if found:
                lines.append(f"{field}: {_format_value(value)}")
    tags = [str(tag) for tag in auxiliary_tags]
    if tags:
        lines.append(
            "confirmed_tags: " + json.dumps(tags, ensure_ascii=False, separators=(",", ":"))
        )

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


def preview_request_prompt(
    *,
    system_preset_id: str | None,
    system_preset_name: str | None,
    system_prompt: str,
    user_prompt: str,
    metadata: object | None,
    selected_fields: Iterable[str],
    configuration_issue: str | None = None,
) -> RequestPromptPreview:
    user_preview = preview_user_prompt(user_prompt, metadata, selected_fields)
    return RequestPromptPreview(
        system_preset_id=system_preset_id,
        system_preset_name=system_preset_name,
        system_prompt=system_prompt,
        user_prompt=user_preview.user_prompt,
        metadata_lines=user_preview.metadata_lines,
        final_user_prompt=user_preview.final_prompt,
        configuration_issue=configuration_issue,
    )
