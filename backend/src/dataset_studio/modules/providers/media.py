from __future__ import annotations

import base64
import mimetypes
from pathlib import Path


def image_mime_type(path: Path) -> str:
    mime_type, _ = mimetypes.guess_type(path.name)
    return mime_type or "application/octet-stream"


def encode_image_base64(path: Path) -> str:
    return base64.b64encode(path.read_bytes()).decode("ascii")


def image_data_url(path: Path) -> str:
    return f"data:{image_mime_type(path)};base64,{encode_image_base64(path)}"
