from __future__ import annotations

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
    return template.replace("{target_language}", target).replace("{language_code}", language)


def translation_user_prompt(language: str, source: str) -> str:
    target = LANGUAGE_LABELS.get(language, language)
    return (
        f"Target language: {target} ({language})\n"
        "Translate the annotation between the boundary lines.\n"
        "----- BEGIN SOURCE ANNOTATION -----\n"
        f"{source}\n"
        "----- END SOURCE ANNOTATION -----"
    )
