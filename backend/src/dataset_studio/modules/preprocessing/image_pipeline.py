from __future__ import annotations

import os
import tempfile
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageOps

from dataset_studio.core.files import file_sha256
from dataset_studio.modules.preprocessing.models import (
    ConvertOptions,
    OutputFormat,
    ResizeAlgorithm,
    ResizeOptions,
)
from dataset_studio.modules.preprocessing.planner import PlanItem

_LOW_HALO_BOX_THRESHOLD = 2.0
_BYTE_IMAGE_MODES = {
    "L",
    "LA",
    "La",
    "RGB",
    "RGBA",
    "RGBa",
    "RGBX",
    "CMYK",
    "YCbCr",
    "HSV",
    "LAB",
}

# Image preparation already uses its own bounded thread pool. Prevent OpenCV's
# Lanczos4 implementation from creating another pool inside every worker.
cv2.setNumThreads(1)
cv2.ocl.setUseOpenCL(False)


def sha256(path: Path) -> str:
    return file_sha256(path)


def render_image_to_staging(
    source: Path,
    staging: Path,
    item: PlanItem,
    resize: ResizeOptions | None,
    convert: ConvertOptions | None,
) -> None:
    staging.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary_name = tempfile.mkstemp(
        prefix=f".{staging.stem}.", suffix=staging.suffix, dir=staging.parent
    )
    os.close(descriptor)
    temporary = Path(temporary_name)
    try:
        with Image.open(source) as opened:
            image = ImageOps.exif_transpose(opened)
            if image.size != (item.after_width, item.after_height):
                algorithm = resize.algorithm if resize else ResizeAlgorithm.LANCZOS3
                image = _resize_image(
                    image,
                    (item.after_width, item.after_height),
                    algorithm,
                )
            image, save_options = _encoding_options(image, staging.suffix, convert)
            image.save(temporary, **save_options)
        os.replace(temporary, staging)
    except BaseException:
        temporary.unlink(missing_ok=True)
        raise


def _resize_image(
    image: Image.Image,
    target_size: tuple[int, int],
    algorithm: ResizeAlgorithm,
) -> Image.Image:
    image = _prepare_resize_mode(image)
    if algorithm == ResizeAlgorithm.LANCZOS4:
        return _resize_lanczos4(image, target_size)
    resampling = _select_pillow_resampling(image.size, target_size, algorithm)
    return image.resize(target_size, resampling)


def _prepare_resize_mode(image: Image.Image) -> Image.Image:
    if image.mode == "1":
        return image.convert("RGB")
    if image.mode in {"P", "PA"}:
        has_alpha = image.mode == "PA" or "transparency" in image.info
        return image.convert("RGBA" if has_alpha else "RGB")
    return image


def _select_pillow_resampling(
    source_size: tuple[int, int],
    target_size: tuple[int, int],
    algorithm: ResizeAlgorithm,
) -> Image.Resampling:
    if algorithm == ResizeAlgorithm.LANCZOS3:
        return Image.Resampling.LANCZOS
    if algorithm == ResizeAlgorithm.ANIME_LOW_HALO:
        shrink_factor = max(
            source_size[0] / target_size[0],
            source_size[1] / target_size[1],
        )
        if shrink_factor >= _LOW_HALO_BOX_THRESHOLD:
            return Image.Resampling.BOX
        return Image.Resampling.HAMMING
    raise ValueError(f"缩放算法不能由 Pillow 执行：{algorithm}")


def _resize_lanczos4(image: Image.Image, target_size: tuple[int, int]) -> Image.Image:
    restore_mode: str | None = None
    working = image
    if image.mode == "RGBA":
        working = image.convert("RGBa")
        restore_mode = "RGBA"
    elif image.mode == "LA":
        working = image.convert("La")
        restore_mode = "LA"

    source_array = np.asarray(working)
    if source_array.dtype == np.int32:
        resized_array = cv2.resize(
            source_array.astype(np.float32),
            target_size,
            interpolation=cv2.INTER_LANCZOS4,
        )
        result = Image.fromarray(np.rint(resized_array).astype(np.int32))
    else:
        if not source_array.dtype.isnative:
            source_array = source_array.astype(source_array.dtype.newbyteorder("="))
        resized_array = cv2.resize(
            source_array,
            target_size,
            interpolation=cv2.INTER_LANCZOS4,
        )
        resized_array = np.ascontiguousarray(resized_array)
        if working.mode in _BYTE_IMAGE_MODES and resized_array.dtype == np.uint8:
            result = Image.frombytes(working.mode, target_size, resized_array.tobytes())
        else:
            result = Image.fromarray(resized_array)

    if restore_mode is not None:
        result = result.convert(restore_mode)
    result.info = image.info.copy()
    return result


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
