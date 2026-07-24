from __future__ import annotations

import re

LANGUAGE_PATTERN = re.compile(r"^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$")


def normalize_language_code(value: str) -> str:
    normalized = value.strip()
    if not LANGUAGE_PATTERN.fullmatch(normalized):
        raise ValueError("语言代码格式无效。")
    parts = normalized.split("-")
    canonical = [parts[0].lower()]
    for part in parts[1:]:
        if len(part) == 2 and part.isalpha():
            canonical.append(part.upper())
        elif len(part) == 4 and part.isalpha():
            canonical.append(part.title())
        else:
            canonical.append(part.lower())
    return "-".join(canonical)
