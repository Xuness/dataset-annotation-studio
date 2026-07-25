from __future__ import annotations

from dataset_studio.modules.annotations.models import AnnotationTag
from dataset_studio.modules.translations.identity import TranslationSourceKind
from dataset_studio.modules.translations.validation import (
    DESCRIPTION_TRANSLATION_PROTOCOL_VERSION,
    render_description_translation_source,
    render_tag_translation_source,
)

LANGUAGE_LABELS = {
    "zh-CN": "简体中文",
    "zh-TW": "繁體中文",
    "en": "English",
    "ja": "日本語",
    "ko": "한국어",
}

DEFAULT_TRANSLATION_PROMPT_PRESET_ID = "default-translation-prompt"


def render_translation_system_prompt(template: str, language: str) -> str:
    target = LANGUAGE_LABELS.get(language, language)
    return template.replace("{target_language}", target).replace(
        "{language_code}",
        language,
    )


def translation_user_prompt(
    language: str,
    source: str,
    *,
    source_kind: TranslationSourceKind = TranslationSourceKind.DESCRIPTION,
    tags: list[AnnotationTag] | None = None,
    protocol_version: int = DESCRIPTION_TRANSLATION_PROTOCOL_VERSION,
) -> str:
    target = LANGUAGE_LABELS.get(language, language)
    if source_kind == TranslationSourceKind.TAGS:
        structured_source = render_tag_translation_source(tags or [])
        return (
            f"Target language: {target} ({language})\n"
            "Translate each Tag inside the XML envelope. Return only the XML.\n"
            "----- BEGIN SOURCE TAGS -----\n"
            f"{structured_source}\n"
            "----- END SOURCE TAGS -----"
        )
    if protocol_version >= DESCRIPTION_TRANSLATION_PROTOCOL_VERSION:
        structured_source = render_description_translation_source(source)
        return (
            f"Target language: {target} ({language})\n"
            "Translate every string value in the JSON object. Return only a JSON object "
            "with exactly the same keys.\n"
            "----- BEGIN SOURCE SEGMENTS -----\n"
            f"{structured_source}\n"
            "----- END SOURCE SEGMENTS -----"
        )
    return (
        f"Target language: {target} ({language})\n"
        "Translate the annotation between the boundary lines.\n"
        "----- BEGIN SOURCE ANNOTATION -----\n"
        f"{source}\n"
        "----- END SOURCE ANNOTATION -----"
    )
