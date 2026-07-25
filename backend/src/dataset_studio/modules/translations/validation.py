from __future__ import annotations

import json
import re
import unicodedata
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field
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


DESCRIPTION_TRANSLATION_PROTOCOL_VERSION = 2


@dataclass(frozen=True, slots=True)
class DescriptionTranslationResponse:
    valid: bool
    status: str
    issue: str | None = None
    content: str = ""
    alignment_parts: list[TranslationAlignmentPart] = field(default_factory=list)
    segment_translations: dict[str, str] = field(default_factory=dict)
    quality_issues: list[str] = field(default_factory=list)


@dataclass(frozen=True, slots=True)
class _StructureToken:
    kind: str
    text: str


@dataclass(frozen=True, slots=True)
class _DescriptionProtocolPart:
    id: str
    kind: str
    text: str


_CLAUSE_BOUNDARIES = frozenset(",，.。!！?？;；:：、…")
_BOUNDARY_CLOSERS = frozenset("\"'”’」』）》】")
_LATIN_PATTERN = re.compile(r"[A-Za-z]")
_CJK_PATTERN = re.compile(r"[\u3400-\u9fff]")
_JAPANESE_PATTERN = re.compile(r"[\u3040-\u30ff\u3400-\u9fff]")
_KOREAN_PATTERN = re.compile(r"[\uac00-\ud7af]")


def render_description_translation_source(source: str) -> str:
    payload = {
        part.id: part.text for part in _description_protocol_parts(source) if part.kind == "segment"
    }
    return json.dumps(payload, ensure_ascii=False, separators=(",", ":"))


def parse_description_translation_response(
    source: str,
    response: str,
    target_language: str,
) -> DescriptionTranslationResponse:
    parsed, parse_issue = _parse_segment_object(response)
    if parsed is None:
        return DescriptionTranslationResponse(
            valid=False,
            status="invalid_response",
            issue=parse_issue,
        )

    valid, issue, content, parts = _description_alignment_from_segments(source, parsed)
    if not valid:
        return DescriptionTranslationResponse(
            valid=False,
            status="invalid_response",
            issue=issue,
        )

    quality_issues = _description_quality_issues(parts, target_language)
    translated_segments = [part for part in parts if part.kind == "segment"]
    comparable_segments = [
        part
        for part in translated_segments
        if _segment_requires_translation(part.source_text, target_language)
    ]
    if (
        comparable_segments
        and sum(
            character.isalpha() for part in comparable_segments for character in part.source_text
        )
        >= 8
        and all(
            _comparison_text(part.source_text) == _comparison_text(part.translated_text)
            for part in comparable_segments
        )
    ):
        return DescriptionTranslationResponse(
            valid=False,
            status="untranslated",
            issue="LLM 返回内容与原文相同，没有完成翻译。",
            content=content,
            alignment_parts=parts,
            segment_translations=parsed,
            quality_issues=quality_issues,
        )

    return DescriptionTranslationResponse(
        valid=True,
        status="quality_warning" if quality_issues else "aligned",
        content=content,
        alignment_parts=parts,
        segment_translations=parsed,
        quality_issues=quality_issues,
    )


def align_description_translation_segments(
    source: str,
    translated: str,
    segment_translations: object,
) -> tuple[bool, str, list[TranslationAlignmentPart]]:
    if not isinstance(segment_translations, dict):
        return False, "译文缺少可用的句段映射。", []
    if any(
        not isinstance(key, str) or not isinstance(value, str)
        for key, value in segment_translations.items()
    ):
        return False, "译文句段映射包含无效的键或内容。", []
    normalized = dict(segment_translations)
    valid, issue, rebuilt, parts = _description_alignment_from_segments(source, normalized)
    if not valid:
        return False, issue, []
    if rebuilt != translated:
        return False, "译文内容已经变化，原有句段映射不再适用。", []
    return True, "aligned", parts


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


def _description_protocol_parts(content: str) -> list[_DescriptionProtocolPart]:
    raw_parts: list[tuple[str, str]] = []
    text_buffer: list[str] = []

    def flush_text() -> None:
        if not text_buffer:
            return
        raw_parts.extend(_split_description_text("".join(text_buffer)))
        text_buffer.clear()

    position = 0
    while position < len(content):
        tag_match = TAG_PATTERN.match(content, position)
        if tag_match is not None:
            flush_text()
            raw_parts.append(("structure", tag_match.group(0)))
            position = tag_match.end()
            continue
        if content.startswith("\r\n", position):
            flush_text()
            raw_parts.append(("structure", "\r\n"))
            position += 2
            continue
        character = content[position]
        if character in {"\r", "\n"}:
            flush_text()
            raw_parts.append(("structure", character))
        else:
            text_buffer.append(character)
        position += 1
    flush_text()

    segment_index = 0
    structure_index = 0
    parts: list[_DescriptionProtocolPart] = []
    for kind, text in raw_parts:
        if kind == "segment":
            part_id = f"segment-{segment_index}"
            segment_index += 1
        else:
            part_id = f"structure-{structure_index}"
            structure_index += 1
        parts.append(_DescriptionProtocolPart(id=part_id, kind=kind, text=text))
    return parts


def _split_description_text(text: str) -> list[tuple[str, str]]:
    if not text:
        return []
    parts: list[tuple[str, str]] = []
    start = 0
    position = 0
    while position < len(text):
        if text[position] not in _CLAUSE_BOUNDARIES:
            position += 1
            continue
        position += 1
        while position < len(text) and (
            text[position] in _CLAUSE_BOUNDARIES or text[position] in _BOUNDARY_CLOSERS
        ):
            position += 1
        value = text[start:position]
        parts.append(("structure" if value.isspace() else "segment", value))
        start = position
    if start < len(text):
        value = text[start:]
        parts.append(("structure" if value.isspace() else "segment", value))
    return parts


def _parse_segment_object(response: str) -> tuple[dict[str, str] | None, str | None]:
    raw = response.strip()
    if raw.startswith("```") and raw.endswith("```"):
        lines = raw.splitlines()
        if len(lines) >= 3 and lines[-1].strip() == "```":
            raw = "\n".join(lines[1:-1]).strip()
    if not raw:
        return None, "译文内容为空。"

    duplicate_keys: set[str] = set()

    def unique_object(pairs: list[tuple[str, object]]) -> dict[str, object]:
        result: dict[str, object] = {}
        for key, value in pairs:
            if key in result:
                duplicate_keys.add(key)
            result[key] = value
        return result

    try:
        value = json.loads(raw, object_pairs_hook=unique_object)
    except json.JSONDecodeError:
        return None, "译文必须是规定的 JSON 句段对象。"
    if duplicate_keys:
        return None, f"译文包含重复句段 ID：{', '.join(sorted(duplicate_keys))}。"
    if not isinstance(value, dict):
        return None, "译文必须是以句段 ID 为键的 JSON 对象。"
    if any(not isinstance(key, str) or not isinstance(item, str) for key, item in value.items()):
        return None, "每个句段 ID 和译文都必须是字符串。"
    return {str(key): str(item) for key, item in value.items()}, None


def _description_alignment_from_segments(
    source: str,
    segment_translations: dict[str, str],
) -> tuple[bool, str, str, list[TranslationAlignmentPart]]:
    protocol_parts = _description_protocol_parts(source)
    expected_ids = [part.id for part in protocol_parts if part.kind == "segment"]
    received_ids = set(segment_translations)
    missing = [part_id for part_id in expected_ids if part_id not in received_ids]
    unexpected = sorted(received_ids.difference(expected_ids))
    if missing or unexpected:
        details = []
        if missing:
            details.append(f"缺少 {', '.join(missing)}")
        if unexpected:
            details.append(f"包含未知 ID {', '.join(unexpected)}")
        return False, f"译文句段 ID 不匹配：{'；'.join(details)}。", "", []

    content_parts: list[str] = []
    alignment_parts: list[TranslationAlignmentPart] = []
    for part in protocol_parts:
        if part.kind == "structure":
            translated_text = part.text
        else:
            translated_text = segment_translations[part.id]
            if not translated_text.strip():
                return False, f"{part.id} 的译文为空。", "", []
            if "\r" in translated_text or "\n" in translated_text:
                return False, f"{part.id} 的译文包含换行。", "", []
            if TAG_PATTERN.search(translated_text):
                return False, f"{part.id} 的译文包含额外 XML 标签。", "", []
        content_parts.append(translated_text)
        alignment_parts.append(
            TranslationAlignmentPart(
                id=part.id,
                kind=part.kind,
                source_text=part.text,
                translated_text=translated_text,
            )
        )
    return True, "aligned", "".join(content_parts), alignment_parts


def _description_quality_issues(
    parts: list[TranslationAlignmentPart],
    target_language: str,
) -> list[str]:
    segments = [part for part in parts if part.kind == "segment"]
    unchanged = [
        part.id
        for part in segments
        if _segment_requires_translation(part.source_text, target_language)
        and len(_comparison_text(part.source_text)) >= 4
        and _comparison_text(part.source_text) == _comparison_text(part.translated_text)
    ]
    issues: list[str] = []
    if unchanged:
        preview = "、".join(unchanged[:4])
        suffix = " 等" if len(unchanged) > 4 else ""
        issues.append(f"{len(unchanged)} 个句段与原文相同，请重点复核：{preview}{suffix}。")

    source_text = "".join(part.source_text for part in segments)
    translated_text = "".join(part.translated_text for part in segments)
    if (
        _segment_requires_translation(source_text, target_language)
        and translated_text.strip()
        and not _contains_target_script(translated_text, target_language)
    ):
        issues.append("译文中未检测到目标语言的主要文字，请确认模型是否完成了翻译。")
    return issues


def _comparison_text(value: str) -> str:
    normalized = unicodedata.normalize("NFKC", value).casefold()
    return "".join(character for character in normalized if character.isalnum())


def _segment_requires_translation(value: str, target_language: str) -> bool:
    normalized_language = target_language.casefold()
    if normalized_language.startswith(("zh", "ja", "ko")):
        return len(_LATIN_PATTERN.findall(value)) >= 3
    if normalized_language.startswith("en"):
        return bool(_CJK_PATTERN.search(value) or _KOREAN_PATTERN.search(value))
    return sum(character.isalpha() for character in value) >= 3


def _contains_target_script(value: str, target_language: str) -> bool:
    normalized_language = target_language.casefold()
    if normalized_language.startswith("zh"):
        return bool(_CJK_PATTERN.search(value))
    if normalized_language.startswith("ja"):
        return bool(_JAPANESE_PATTERN.search(value))
    if normalized_language.startswith("ko"):
        return bool(_KOREAN_PATTERN.search(value))
    if normalized_language.startswith("en"):
        return bool(_LATIN_PATTERN.search(value))
    return True
