from __future__ import annotations

import base64
import mimetypes
from pathlib import Path

_IMAGE_MIME_TYPES = {
    ".bmp": "image/bmp",
    ".jpeg": "image/jpeg",
    ".jpg": "image/jpeg",
    ".png": "image/png",
    ".tif": "image/tiff",
    ".tiff": "image/tiff",
    ".webp": "image/webp",
}


def image_mime_type(path: Path) -> str:
    known_type = _IMAGE_MIME_TYPES.get(path.suffix.lower())
    if known_type is not None:
        return known_type
    mime_type, _ = mimetypes.guess_type(path.name)
    return mime_type or "application/octet-stream"


def encode_image_base64(path: Path) -> str:
    return base64.b64encode(path.read_bytes()).decode("ascii")


def image_data_url(path: Path) -> str:
    return f"data:{image_mime_type(path)};base64,{encode_image_base64(path)}"
