from __future__ import annotations

from dataset_studio.modules.annotations.models import AnnotationTag
from dataset_studio.modules.translations.identity import TranslationSourceKind
from dataset_studio.modules.translations.validation import render_tag_translation_source

LANGUAGE_LABELS = {
    "zh-CN": "简体中文",
    "zh-TW": "繁體中文",
    "en": "English",
    "ja": "日本語",
    "ko": "한국어",
}

DEFAULT_TRANSLATION_PROMPT_PRESET_ID = "default-translation-prompt"


DESCRIPTION_ALIGNMENT_PROTOCOL = """

Mandatory alignment protocol:
- Preserve every XML tag, attribute, attribute value, and XML tag order exactly.
- Preserve every line break exactly.
- Preserve every punctuation character and its order exactly; do not add, remove,
  replace, or move punctuation.
- Translate only the text between those structural markers.
- Do not add explanations, Markdown fences, headings, or commentary.
""".strip()

TAGS_ALIGNMENT_PROTOCOL = """

Mandatory Tags alignment protocol:
- Return exactly one <tags count="..."> root and the same numbered <tag index="...">
  children supplied by the user.
- Preserve every wrapper, index, order, and item count exactly.
- Translate only the text inside each <tag> element.
- Every translated Tag must be non-empty and remain on one line.
- Escape XML-special characters when needed.
- Do not add explanations, Markdown fences, headings, or commentary.
""".strip()


def render_translation_system_prompt(
    template: str,
    language: str,
    source_kind: TranslationSourceKind = TranslationSourceKind.DESCRIPTION,
) -> str:
    target = LANGUAGE_LABELS.get(language, language)
    rendered = template.replace("{target_language}", target).replace(
        "{language_code}",
        language,
    )
    protocol = (
        TAGS_ALIGNMENT_PROTOCOL
        if source_kind == TranslationSourceKind.TAGS
        else DESCRIPTION_ALIGNMENT_PROTOCOL
    )
    return f"{rendered.rstrip()}\n\n{protocol}"


def translation_user_prompt(
    language: str,
    source: str,
    *,
    source_kind: TranslationSourceKind = TranslationSourceKind.DESCRIPTION,
    tags: list[AnnotationTag] | None = None,
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
    return (
        f"Target language: {target} ({language})\n"
        "Translate the annotation between the boundary lines.\n"
        "----- BEGIN SOURCE ANNOTATION -----\n"
        f"{source}\n"
        "----- END SOURCE ANNOTATION -----"
    )
