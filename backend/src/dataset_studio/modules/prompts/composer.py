from __future__ import annotations

import json
from collections.abc import Iterable
from typing import Literal

from pydantic import BaseModel


class PromptPreview(BaseModel):
    user_prompt: str
    metadata_lines: list[str]
    tag_line: str | None
    final_prompt: str


class RequestPromptPreview(BaseModel):
    """The two text messages sent with an image in a multimodal request."""

    system_preset_id: str | None
    system_preset_name: str | None
    system_prompt: str
    user_prompt: str
    metadata_lines: list[str]
    tag_assistance_enabled: bool
    tag_context_status: Literal["disabled", "ready", "unavailable"]
    tag_revision_id: str | None
    tag_count: int
    tag_line: str | None
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


def _metadata_lines(
    metadata: object | None,
    selected_fields: Iterable[str],
) -> list[str]:
    lines: list[str] = []
    if metadata is None:
        return lines
    for field in selected_fields:
        found, value = _resolve_path(metadata, field)
        if found:
            lines.append(f"{field}: {_format_value(value)}")
    return lines


def _tag_line(auxiliary_tags: Iterable[str]) -> str | None:
    tags = [str(tag) for tag in auxiliary_tags]
    if not tags:
        return None
    return "tags: " + json.dumps(tags, ensure_ascii=False, separators=(",", ":"))


def _append_context(user_prompt: str, lines: Iterable[str]) -> str:
    context_lines = list(lines)
    body = user_prompt.rstrip()
    if not context_lines:
        return body
    if not body:
        return "\n".join(context_lines)
    return f"{body}\n\n" + "\n".join(context_lines)


def compose_user_prompt(
    user_prompt: str,
    metadata: object | None,
    selected_fields: Iterable[str],
    auxiliary_tags: Iterable[str] = (),
) -> str:
    lines = _metadata_lines(metadata, selected_fields)
    tag_line = _tag_line(auxiliary_tags)
    if tag_line:
        lines.append(tag_line)
    return _append_context(user_prompt, lines)


def preview_user_prompt(
    user_prompt: str,
    metadata: object | None,
    selected_fields: Iterable[str],
    auxiliary_tags: Iterable[str] = (),
) -> PromptPreview:
    body = user_prompt.rstrip()
    metadata_lines = _metadata_lines(metadata, selected_fields)
    tag_line = _tag_line(auxiliary_tags)
    context_lines = [*metadata_lines, *([tag_line] if tag_line else [])]
    return PromptPreview(
        user_prompt=body,
        metadata_lines=metadata_lines,
        tag_line=tag_line,
        final_prompt=_append_context(body, context_lines),
    )


def preview_request_prompt(
    *,
    system_preset_id: str | None,
    system_preset_name: str | None,
    system_prompt: str,
    user_prompt: str,
    metadata: object | None,
    selected_fields: Iterable[str],
    auxiliary_tags: Iterable[str] = (),
    tag_assistance_enabled: bool = False,
    tag_revision_id: str | None = None,
    configuration_issue: str | None = None,
) -> RequestPromptPreview:
    tags = [str(tag) for tag in auxiliary_tags]
    user_preview = preview_user_prompt(user_prompt, metadata, selected_fields, tags)
    tag_context_status: Literal["disabled", "ready", "unavailable"]
    if not tag_assistance_enabled:
        tag_context_status = "disabled"
    elif user_preview.tag_line:
        tag_context_status = "ready"
    else:
        tag_context_status = "unavailable"
    return RequestPromptPreview(
        system_preset_id=system_preset_id,
        system_preset_name=system_preset_name,
        system_prompt=system_prompt,
        user_prompt=user_preview.user_prompt,
        metadata_lines=user_preview.metadata_lines,
        tag_assistance_enabled=tag_assistance_enabled,
        tag_context_status=tag_context_status,
        tag_revision_id=tag_revision_id,
        tag_count=len(tags),
        tag_line=user_preview.tag_line,
        final_user_prompt=user_preview.final_prompt,
        configuration_issue=configuration_issue,
    )
