from __future__ import annotations

import numpy as np
from PIL import Image


def rgb_image(
    image: Image.Image, *, background: tuple[int, int, int] = (255, 255, 255)
) -> Image.Image:
    if image.mode in {"RGBA", "LA"} or (
        image.mode == "P" and image.info.get("transparency") is not None
    ):
        rgba = image.convert("RGBA")
        canvas = Image.new("RGBA", rgba.size, (*background, 255))
        return Image.alpha_composite(canvas, rgba).convert("RGB")
    return image.convert("RGB")


def square_pad(
    image: Image.Image,
    *,
    background: tuple[int, int, int] = (255, 255, 255),
) -> Image.Image:
    source = rgb_image(image, background=background)
    side = max(source.size)
    canvas = Image.new("RGB", (side, side), background)
    canvas.paste(source, ((side - source.width) // 2, (side - source.height) // 2))
    return canvas


def fit_with_padding(
    image: Image.Image,
    size: int,
    *,
    background: tuple[int, int, int],
    resample: Image.Resampling,
) -> Image.Image:
    source = rgb_image(image, background=background)
    scale = min(size / source.width, size / source.height)
    resized = source.resize(
        (max(1, int(source.width * scale)), max(1, int(source.height * scale))),
        resample,
    )
    canvas = Image.new("RGB", (size, size), background)
    canvas.paste(resized, ((size - resized.width) // 2, (size - resized.height) // 2))
    return canvas


def pad_to_minimum_size(
    image: Image.Image,
    width: int,
    height: int,
    *,
    background: tuple[int, int, int] = (255, 255, 255),
) -> Image.Image:
    source = rgb_image(image, background=background)
    canvas_width = max(width, source.width)
    canvas_height = max(height, source.height)
    canvas = Image.new("RGB", (canvas_width, canvas_height), background)
    canvas.paste(
        source,
        ((canvas_width - source.width) // 2, (canvas_height - source.height) // 2),
    )
    return canvas


def resize_shorter_side_and_center_crop(
    image: Image.Image,
    size: int,
    *,
    resample: Image.Resampling,
) -> Image.Image:
    resized = resize_shorter_side(image, size, resample=resample)
    return center_crop(resized, size)


def resize_shorter_side(
    image: Image.Image,
    size: int,
    *,
    resample: Image.Resampling,
) -> Image.Image:
    scale = size / min(image.width, image.height)
    return image.resize(
        (max(size, int(image.width * scale)), max(size, int(image.height * scale))),
        resample,
    )


def center_crop(image: Image.Image, size: int) -> Image.Image:
    left = (image.width - size) // 2
    top = (image.height - size) // 2
    return image.crop((left, top, left + size, top + size))


def normalize_nchw(
    image: Image.Image,
    *,
    mean: tuple[float, float, float],
    std: tuple[float, float, float],
) -> np.ndarray:
    pixels = np.asarray(image, dtype=np.float32) / 255.0
    normalized = (pixels - np.asarray(mean, dtype=np.float32)) / np.asarray(
        std,
        dtype=np.float32,
    )
    return np.ascontiguousarray(normalized.transpose(2, 0, 1))
