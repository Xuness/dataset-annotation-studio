from __future__ import annotations


def extract_chat_message_reasoning(message: object) -> str | None:
    if not isinstance(message, dict):
        return None
    for key in ("reasoning_content", "reasoning", "reasoning_details"):
        text = _text_value(message.get(key))
        if text:
            return text
    return None


def extract_anthropic_reasoning(blocks: object) -> str | None:
    if not isinstance(blocks, list):
        return None
    return _join_text(
        _text_value(block.get("thinking") or block.get("text"))
        for block in blocks
        if isinstance(block, dict) and block.get("type") in {"thinking", "redacted_thinking"}
    )


def extract_gemini_reasoning(parts: object) -> str | None:
    if not isinstance(parts, list):
        return None
    return _join_text(
        _text_value(part.get("text"))
        for part in parts
        if isinstance(part, dict) and part.get("thought") is True
    )


def extract_codex_reasoning(items: object) -> str | None:
    if not isinstance(items, list):
        return None
    fragments: list[str | None] = []
    for item in items:
        if not isinstance(item, dict) or item.get("type") != "reasoning":
            continue
        fragments.extend(
            (
                _text_value(item.get("summary")),
                _text_value(item.get("content")),
            )
        )
    return _join_text(fragments)


def extract_reasoning_from_raw(raw: object) -> str | None:
    """Read provider-returned reasoning without exposing the rest of the raw payload."""

    if not isinstance(raw, dict):
        return None

    choices = raw.get("choices")
    if isinstance(choices, list) and choices and isinstance(choices[0], dict):
        reasoning = extract_chat_message_reasoning(choices[0].get("message"))
        if reasoning:
            return reasoning

    reasoning = extract_anthropic_reasoning(raw.get("content"))
    if reasoning:
        return reasoning

    candidates = raw.get("candidates")
    if isinstance(candidates, list) and candidates and isinstance(candidates[0], dict):
        candidate_content = candidates[0].get("content")
        if isinstance(candidate_content, dict):
            reasoning = extract_gemini_reasoning(candidate_content.get("parts"))
            if reasoning:
                return reasoning

    reasoning = extract_codex_reasoning(raw.get("items"))
    if reasoning:
        return reasoning

    return _text_value(raw.get("reasoning_content"))


def _text_value(value: object) -> str | None:
    if isinstance(value, str):
        return value if value.strip() else None
    if isinstance(value, list):
        return _join_text(_text_value(item) for item in value)
    if not isinstance(value, dict):
        return None
    for key in ("text", "thinking", "reasoning_content", "content", "summary"):
        text = _text_value(value.get(key))
        if text:
            return text
    return None


def _join_text(values) -> str | None:
    fragments = [value for value in values if value and value.strip()]
    return "\n\n".join(fragments) or None
