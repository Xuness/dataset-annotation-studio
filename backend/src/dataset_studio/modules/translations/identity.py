from __future__ import annotations

from enum import StrEnum


class TranslationSourceKind(StrEnum):
    DESCRIPTION = "description"
    TAGS = "tags"


class TranslationProducerKind(StrEnum):
    LLM = "llm"
    LOCAL_DICTIONARY = "local_dictionary"


DEFAULT_TRANSLATION_SOURCE_KIND = TranslationSourceKind.DESCRIPTION
DEFAULT_TRANSLATION_PRODUCER_KIND = TranslationProducerKind.LLM


def translation_identity_values(
    source_kind: TranslationSourceKind | str = DEFAULT_TRANSLATION_SOURCE_KIND,
    producer_kind: TranslationProducerKind | str = DEFAULT_TRANSLATION_PRODUCER_KIND,
) -> tuple[str, str]:
    return (
        TranslationSourceKind(source_kind).value,
        TranslationProducerKind(producer_kind).value,
    )
