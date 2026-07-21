from __future__ import annotations

from pathlib import Path

from dataset_studio.modules.annotations.models import (
    AnnotationStatus,
    ValidationIssue,
    ValidationResult,
)
from dataset_studio.modules.annotations.tag_balance import validate_tag_balance


class AnnotationEncodingError(ValueError):
    """Raised when an annotation is not valid UTF-8."""


def decode_annotation_bytes(content: bytes) -> tuple[str, ValidationResult]:
    try:
        text = content.decode("utf-8")
    except UnicodeDecodeError as error:
        return (
            content.decode("utf-8", errors="replace"),
            ValidationResult(
                valid=False,
                status=AnnotationStatus.ENCODING_ERROR,
                issues=[
                    ValidationIssue(
                        code="invalid_encoding",
                        message="标注文件不是有效的 UTF-8。",
                        offset=error.start,
                    )
                ],
            ),
        )
    return text, validate_tag_balance(text)


def read_annotation_text(path: Path) -> tuple[str, ValidationResult]:
    return decode_annotation_bytes(path.read_bytes())


def read_annotation_text_strict(path: Path) -> str:
    text, validation = read_annotation_text(path)
    if validation.status == AnnotationStatus.ENCODING_ERROR:
        raise AnnotationEncodingError(f"标注文件不是有效的 UTF-8：{path.name}")
    return text
