from __future__ import annotations

import re
from collections.abc import Iterator

TAG_PATTERN = re.compile(
    r"<\s*(?P<closing>/?)\s*(?P<name>[A-Za-z_][\w:.-]*)"
    r"(?P<attributes>\s[^<>]*?)?(?P<self_closing>/?)\s*>",
    re.MULTILINE,
)


def iter_start_tag_names(content: str) -> Iterator[str]:
    """Yield element names without treating annotation text as a canonical model."""

    for match in TAG_PATTERN.finditer(content):
        if not match.group("closing"):
            yield match.group("name")
