from __future__ import annotations

import re
from dataclasses import dataclass

from dataset_studio.modules.annotations.models import (
    AnnotationStatus,
    ValidationIssue,
    ValidationResult,
)
from dataset_studio.modules.annotations.tag_syntax import TAG_PATTERN

INCOMPLETE_TAG_PATTERN = re.compile(r"<\s*/?\s*[A-Za-z_][\w:.-]*(?:\s[^>]*)?\Z")


@dataclass(frozen=True, slots=True)
class _OpenTag:
    name: str
    offset: int


def validate_tag_balance(content: str) -> ValidationResult:
    if not content.strip():
        return ValidationResult(
            valid=False,
            status=AnnotationStatus.EMPTY,
            issues=[ValidationIssue(code="empty", message="标注内容为空。")],
        )

    stack: list[_OpenTag] = []
    issues: list[ValidationIssue] = []
    tag_count = 0

    for match in TAG_PATTERN.finditer(content):
        name = match.group("name")
        closing = bool(match.group("closing"))
        self_closing = bool(match.group("self_closing"))
        tag_count += 1

        if self_closing and not closing:
            continue

        if not closing:
            stack.append(_OpenTag(name=name, offset=match.start()))
            continue

        if not stack:
            issues.append(
                ValidationIssue(
                    code="unexpected_closing_tag",
                    message=f"结束标签 </{name}> 没有对应的开始标签。",
                    offset=match.start(),
                    tag=name,
                )
            )
            continue

        expected = stack[-1]
        if expected.name != name:
            issues.append(
                ValidationIssue(
                    code="mismatched_closing_tag",
                    message=f"期望 </{expected.name}>，实际遇到 </{name}>。",
                    offset=match.start(),
                    tag=name,
                )
            )
            continue

        stack.pop()

    for open_tag in reversed(stack):
        issues.append(
            ValidationIssue(
                code="unclosed_tag",
                message=f"标签 <{open_tag.name}> 没有闭合。",
                offset=open_tag.offset,
                tag=open_tag.name,
            )
        )

    incomplete_match = INCOMPLETE_TAG_PATTERN.search(content)
    if incomplete_match:
        issues.append(
            ValidationIssue(
                code="incomplete_tag",
                message="文本末尾存在未完成的标签。",
                offset=incomplete_match.start(),
            )
        )

    return ValidationResult(
        valid=not issues,
        status=AnnotationStatus.VALID if not issues else AnnotationStatus.INVALID,
        tag_count=tag_count,
        issues=issues,
    )
