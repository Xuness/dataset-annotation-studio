from __future__ import annotations

import unicodedata
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from xml.sax.saxutils import escape

from dataset_studio.modules.annotations.models import AnnotationTag
from dataset_studio.modules.annotations.tag_balance import validate_tag_balance
from dataset_studio.modules.annotations.tag_syntax import TAG_PATTERN


@dataclass(frozen=True, slots=True)
class TranslationAlignmentPart:
    id: str
    kind: str
    source_text: str
    translated_text: str
    category: str | None = None
    confidence: float | None = None


@dataclass(frozen=True, slots=True)
class _StructureToken:
    kind: str
    text: str


def align_description_translation(
    source: str,
    translated: str,
) -> tuple[bool, str, list[TranslationAlignmentPart]]:
    if not translated.strip():
        return False, "译文内容为空。", []

    source_balance = validate_tag_balance(source)
    translated_balance = validate_tag_balance(translated)
    if source_balance.valid and not translated_balance.valid:
        return False, translated_balance.issues[0].message, []

    source_tokens = _description_tokens(source)
    translated_tokens = _description_tokens(translated)
    if len(source_tokens) != len(translated_tokens):
        return False, "译文改变了原文的 XML、换行或标点结构。", []

    parts: list[TranslationAlignmentPart] = []
    segment_index = 0
    structure_index = 0
    for source_token, translated_token in zip(source_tokens, translated_tokens, strict=True):
        if source_token.kind != translated_token.kind:
            return False, "译文改变了原文的 XML、换行或标点结构。", []
        if source_token.kind == "structure":
            if source_token.text != translated_token.text:
                return False, "译文改变了原文的 XML、换行或标点结构。", []
            part_id = f"structure-{structure_index}"
            structure_index += 1
        else:
            if source_token.text.isspace() and source_token.text != translated_token.text:
                return False, "译文改变了原文的空白文本结构。", []
            part_id = f"segment-{segment_index}"
            segment_index += 1
        parts.append(
            TranslationAlignmentPart(
                id=part_id,
                kind=source_token.kind,
                source_text=source_token.text,
                translated_text=translated_token.text,
            )
        )
    return True, "structure_preserved", parts


def validate_translation_structure(source: str, translated: str) -> tuple[bool, str]:
    valid, issue, _ = align_description_translation(source, translated)
    return valid, issue


def render_tag_translation_source(tags: list[AnnotationTag]) -> str:
    lines = [f'<tags count="{len(tags)}">']
    lines.extend(
        f'  <tag index="{index}">{escape(tag.name)}</tag>' for index, tag in enumerate(tags)
    )
    lines.append("</tags>")
    return "\n".join(lines)


def parse_tag_translation_response(
    response: str,
    source_tags: list[AnnotationTag],
) -> tuple[bool, str, str]:
    if not response.strip():
        return False, "译文内容为空。", ""
    try:
        root = ET.fromstring(response)
    except ET.ParseError:
        return False, "Tags 译文必须保持规定的 XML 包装。", ""
    if root.tag != "tags" or root.attrib != {"count": str(len(source_tags))}:
        return False, "Tags 译文改变了根节点或 Tag 数量。", ""
    if root.text is not None and root.text.strip():
        return False, "Tags 译文改变了 Tag 序号、顺序或 XML 结构。", ""
    children = list(root)
    if len(children) != len(source_tags):
        return False, "Tags 译文数量与源 Tags 不一致。", ""
    translated_tags: list[str] = []
    for index, child in enumerate(children):
        if (
            child.tag != "tag"
            or child.attrib != {"index": str(index)}
            or list(child)
            or (child.tail is not None and child.tail.strip())
        ):
            return False, "Tags 译文改变了 Tag 序号、顺序或 XML 结构。", ""
        value = (child.text or "").strip()
        if not value or "\n" in value or "\r" in value:
            return False, f"第 {index + 1} 个 Tag 的译文为空或包含换行。", ""
        translated_tags.append(value)
    return True, "structure_preserved", "\n".join(translated_tags)


def align_tag_translation(
    source_tags: list[AnnotationTag],
    translated: str,
) -> tuple[bool, str, list[TranslationAlignmentPart]]:
    values = translated.splitlines()
    if len(values) != len(source_tags):
        return False, "Tags 译文数量与源 Tags 不一致。", []
    parts: list[TranslationAlignmentPart] = []
    for index, (tag, value) in enumerate(zip(source_tags, values, strict=True)):
        normalized = value.strip()
        if not normalized:
            return False, f"第 {index + 1} 个 Tag 的译文为空。", []
        parts.append(
            TranslationAlignmentPart(
                id=f"tag-{index}",
                kind="tag",
                source_text=tag.name,
                translated_text=normalized,
                category=tag.category,
                confidence=tag.confidence,
            )
        )
    return True, "structure_preserved", parts


def _description_tokens(content: str) -> list[_StructureToken]:
    tokens: list[_StructureToken] = []
    text_buffer: list[str] = []

    def flush_text() -> None:
        if text_buffer:
            tokens.append(_StructureToken("segment", "".join(text_buffer)))
            text_buffer.clear()

    position = 0
    while position < len(content):
        tag_match = TAG_PATTERN.match(content, position)
        if tag_match is not None:
            flush_text()
            tokens.append(_StructureToken("structure", tag_match.group(0)))
            position = tag_match.end()
            continue
        if content.startswith("\r\n", position):
            flush_text()
            tokens.append(_StructureToken("structure", "\r\n"))
            position += 2
            continue
        character = content[position]
        if character in {"\r", "\n"} or unicodedata.category(character).startswith("P"):
            flush_text()
            tokens.append(_StructureToken("structure", character))
        else:
            text_buffer.append(character)
        position += 1
    flush_text()
    return tokens
