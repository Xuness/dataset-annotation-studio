from __future__ import annotations

import os
import tempfile
from pathlib import Path

from PIL import Image, ImageOps

from dataset_studio.core.files import file_sha256
from dataset_studio.modules.preprocessing.models import ConvertOptions, OutputFormat
from dataset_studio.modules.preprocessing.planner import PlanItem


def sha256(path: Path) -> str:
    return file_sha256(path)


def render_image(
    source: Path,
    target: Path,
    item: PlanItem,
    convert: ConvertOptions | None,
) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary_name = tempfile.mkstemp(
        prefix=f".{target.stem}.", suffix=target.suffix, dir=target.parent
    )
    os.close(descriptor)
    temporary = Path(temporary_name)
    try:
        with Image.open(source) as opened:
            image = ImageOps.exif_transpose(opened)
            if image.size != (item.after_width, item.after_height):
                image = image.resize(
                    (item.after_width, item.after_height), Image.Resampling.LANCZOS
                )
            image, save_options = _encoding_options(image, target.suffix, convert)
            image.save(temporary, **save_options)
        os.replace(temporary, target)
        if source.resolve() != target.resolve():
            source.unlink()
    except BaseException:
        temporary.unlink(missing_ok=True)
        raise


def _encoding_options(
    image: Image.Image,
    suffix: str,
    convert: ConvertOptions | None,
) -> tuple[Image.Image, dict[str, object]]:
    if convert is None:
        normalized_suffix = suffix.lower()
        if normalized_suffix in {".bmp"}:
            return _rgb_or_rgba(image), {"format": "BMP"}
        if normalized_suffix in {".tif", ".tiff"}:
            return image, {"format": "TIFF", "compression": "tiff_lzw"}
        output_format = _format_from_suffix(normalized_suffix)
    else:
        output_format = convert.format
    if output_format == OutputFormat.WEBP:
        return _rgb_or_rgba(image), {
            "format": "WEBP",
            "quality": convert.quality if convert else 90,
            "method": convert.effort if convert else 4,
        }
    if output_format == OutputFormat.JPEG:
        return _flatten_for_jpeg(image), {
            "format": "JPEG",
            "quality": convert.quality if convert else 95,
            "optimize": True,
        }
    if image.mode not in {"1", "L", "LA", "P", "RGB", "RGBA", "I", "I;16"}:
        image = _rgb_or_rgba(image)
    return image, {"format": "PNG", "compress_level": 6}


def _format_from_suffix(suffix: str) -> OutputFormat:
    if suffix.lower() == ".webp":
        return OutputFormat.WEBP
    if suffix.lower() in {".jpg", ".jpeg"}:
        return OutputFormat.JPEG
    if suffix.lower() == ".png":
        return OutputFormat.PNG
    raise ValueError(f"无法在不转换格式的情况下写入图片：{suffix}")


def _flatten_for_jpeg(image: Image.Image) -> Image.Image:
    if image.mode in {"RGB", "L"}:
        return image.convert("RGB")
    rgba = image.convert("RGBA")
    background = Image.new("RGBA", rgba.size, (255, 255, 255, 255))
    background.alpha_composite(rgba)
    return background.convert("RGB")


def _rgb_or_rgba(image: Image.Image) -> Image.Image:
    if image.mode in {"RGB", "RGBA"}:
        return image
    return image.convert("RGBA" if "transparency" in image.info else "RGB")
