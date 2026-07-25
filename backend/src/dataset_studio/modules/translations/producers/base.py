from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol

from dataset_studio.modules.annotations.models import AnnotationTag
from dataset_studio.modules.translations.identity import TranslationSourceKind


@dataclass(frozen=True, slots=True)
class TranslationProducerRequest:
    language: str
    source_kind: TranslationSourceKind
    source_content: str
    source_tags: tuple[AnnotationTag, ...] = ()


@dataclass(frozen=True, slots=True)
class TranslationProducerResult:
    content: str
    raw_content: str


class TranslationProducer(Protocol):
    def translate(self, request: TranslationProducerRequest) -> TranslationProducerResult: ...
