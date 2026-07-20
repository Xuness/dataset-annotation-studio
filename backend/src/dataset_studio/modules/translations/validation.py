from __future__ import annotations

import re

from dataset_studio.modules.annotations.tag_balance import validate_tag_balance
from dataset_studio.modules.annotations.tag_syntax import TAG_PATTERN


def validate_translation_structure(source: str, translated: str) -> tuple[bool, str]:
    if not translated.strip():
        return False, "译文内容为空。"

    source_tags = _tag_signature(source)
    translated_tags = _tag_signature(translated)
    if source_tags != translated_tags:
        return False, "译文改变了原标注的标签、属性或标签顺序。"

    source_balance = validate_tag_balance(source)
    translated_balance = validate_tag_balance(translated)
    if source_balance.valid and not translated_balance.valid:
        return False, translated_balance.issues[0].message
    return True, "structure_preserved"


def _tag_signature(content: str) -> list[tuple[bool, str, str, bool]]:
    signature: list[tuple[bool, str, str, bool]] = []
    for match in TAG_PATTERN.finditer(content):
        attributes = re.sub(r"\s+", " ", (match.group("attributes") or "").strip())
        signature.append(
            (
                bool(match.group("closing")),
                match.group("name"),
                attributes,
                bool(match.group("self_closing")),
            )
        )
    return signature
