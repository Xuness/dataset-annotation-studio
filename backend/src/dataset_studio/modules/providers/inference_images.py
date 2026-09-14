from __future__ import annotations

import io
from dataclasses import dataclass
from pathlib import Path

from PIL import Image, ImageCms, ImageOps, UnidentifiedImageError

from dataset_studio.core.file_targets import fingerprint
from dataset_studio.core.files import file_sha256


class InferenceImageError(ValueError):
    """The source cannot be represented within the configured request limit."""


@dataclass(frozen=True, slots=True)
class EncodedImage:
    content: bytes
    suffix: str
    width: int
    height: int


@dataclass(frozen=True, slots=True)
class PreparedInferenceImage:
    source_path: Path
    source_hash: str
    source_bytes: int
    path: Path
    byte_size: int
    width: int
    height: int
    compressed: bool
    max_bytes: int | None
    source_width: int
    source_height: int
    content_hash: str
    mime_type: str


def compress_image(source: bytes, max_bytes: int) -> EncodedImage:
    """Encode independent variants from the oriented image, preserving alpha."""
    if max_bytes < 1:
        raise InferenceImageError("推理图片上限必须大于零。")
    with Image.open(io.BytesIO(source)) as opened:
        if getattr(opened, "n_frames", 1) != 1:
            raise InferenceImageError("超限多帧图片暂不支持推理压缩。")
        oriented = ImageOps.exif_transpose(opened)
        rgba = oriented.convert("RGBA")
        alpha = rgba.getchannel("A")
        transparent = alpha.getextrema()[0] < 255
        color = oriented.convert("RGB")
        profile = opened.info.get("icc_profile")
        if profile:
            color = ImageCms.profileToProfile(
                oriented,
                ImageCms.ImageCmsProfile(io.BytesIO(profile)),
                ImageCms.createProfile("sRGB"),
                outputMode="RGB",
            )
        if transparent:
            color.putalpha(alpha)
        maximum = max(color.size)
        minimum = min(maximum, 64)
        edge = maximum
        for _ in range(33):
            size = (
                max(1, round(color.width * edge / maximum)),
                max(1, round(color.height * edge / maximum)),
            )
            variant = color if size == color.size else color.resize(size, Image.Resampling.LANCZOS)
            qualities = (95,) if transparent else (95, 90, 85, 80, 75)
            for quality in qualities:
                buffer = io.BytesIO()
                if transparent:
                    variant.save(buffer, format="PNG", optimize=True)
                else:
                    variant.save(buffer, format="JPEG", quality=quality, optimize=True)
                content = buffer.getvalue()
                if len(content) <= max_bytes:
                    with Image.open(io.BytesIO(content)) as verified:
                        verified.load()
                        if verified.size != size:
                            raise InferenceImageError("推理压缩输出尺寸校验失败。")
                    return EncodedImage(content, ".png" if transparent else ".jpg", *size)
            if edge == minimum:
                break
            edge = max(minimum, int(edge * 0.85))
    raise InferenceImageError(f"在最小尺寸和质量边界内无法压缩至 {max_bytes} 字节。")


def prepare_inference_image(
    source: Path, cache: Path, max_bytes: int | None, expected_hash: str
) -> PreparedInferenceImage:
    observed = fingerprint(source)
    if not observed.exists or observed.content_hash != expected_hash:
        raise InferenceImageError(f"推理源图片与项目索引不一致，请重新扫描：{source}")
    try:
        with Image.open(source) as image:
            width, height = image.size
            mime_type = Image.MIME.get(image.format, "application/octet-stream")
        if max_bytes is None or observed.byte_size <= max_bytes:
            return PreparedInferenceImage(
                source,
                expected_hash,
                observed.byte_size,
                source,
                observed.byte_size,
                width,
                height,
                False,
                max_bytes,
                width,
                height,
                expected_hash,
                mime_type,
            )
        encoded = compress_image(source.read_bytes(), max_bytes)
        if fingerprint(source) != observed:
            raise InferenceImageError(f"推理压缩期间源图片发生变化：{source}")
        cache.mkdir(parents=True, exist_ok=False)
        target = cache / ("image" + encoded.suffix)
        target.write_bytes(encoded.content)
        if target.stat().st_size > max_bytes:
            raise InferenceImageError("推理压缩输出超过大小限制。")
        return PreparedInferenceImage(
            source,
            expected_hash,
            observed.byte_size,
            target,
            len(encoded.content),
            encoded.width,
            encoded.height,
            True,
            max_bytes,
            width,
            height,
            file_sha256(target),
            "image/png" if encoded.suffix == ".png" else "image/jpeg",
        )
    except (OSError, UnidentifiedImageError, ImageCms.PyCMSError, ValueError) as error:
        raise InferenceImageError(
            f"推理图片准备失败：{source}；原大小 {observed.byte_size} 字节，"
            f"上限 {max_bytes} 字节；{error}"
        ) from error


def validate_inference_source(prepared: PreparedInferenceImage) -> None:
    if prepared.compressed and (
        not prepared.path.is_file() or file_sha256(prepared.path) != prepared.content_hash
    ):
        raise InferenceImageError(f"推理压缩副本缺失或发生变化：{prepared.path}")
    if (
        not prepared.source_path.is_file()
        or file_sha256(prepared.source_path) != prepared.source_hash
    ):
        raise InferenceImageError(
            f"LLM 请求期间原图片发生变化，请重新扫描并标注：{prepared.source_path}"
        )
