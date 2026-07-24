from __future__ import annotations

import threading
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from dataset_studio.modules.preprocessing.cuda_resize import (
    CudaResizeError,
    load_cupy,
    resize_array_cuda,
)
from dataset_studio.modules.preprocessing.models import (
    ConvertOptions,
    OutputFormat,
    ResizeAlgorithm,
    ResizeOptions,
)

_CUDA_CODEC_LOCK = threading.RLock()


class CudaPipelineError(RuntimeError):
    """Raised when the optional all-GPU image pipeline cannot process an image."""


@dataclass(slots=True)
class CudaImage:
    pixels: Any
    mode: str
    codec_image: Any


@dataclass(frozen=True, slots=True)
class CudaPipelineStatus:
    available: bool
    reason: str | None


try:
    from dataset_studio.modules.preprocessing.planner import PlanItem
except ImportError:  # pragma: no cover - only helps static import tooling
    PlanItem = Any  # type: ignore[misc,assignment]


class CudaImagePipeline:
    """Decode, resize and encode an image without materializing a PIL image."""

    def __init__(self) -> None:
        cp, reason = load_cupy()
        if cp is None:
            raise CudaPipelineError(reason or "CUDA 运行时不可用。")
        try:
            import nvidia.nvimgcodec as nvimgcodec
        except Exception as error:
            raise CudaPipelineError(f"未安装或无法加载 nvImageCodec：{error}") from error
        self._cp = cp
        self._nvimgcodec = nvimgcodec
        try:
            self._decoder = nvimgcodec.Decoder(device_id=0)
            self._encoder = nvimgcodec.Encoder(device_id=0)
        except Exception as error:
            raise CudaPipelineError(f"CUDA 图像编解码器初始化失败：{error}") from error

    def render(
        self,
        source: Path,
        staging: Path,
        item: PlanItem,
        resize: ResizeOptions | None,
        convert: ConvertOptions | None,
    ) -> None:
        output_format = _output_format(staging.suffix, convert)
        if output_format is None:
            raise CudaPipelineError(f"CUDA 编码暂不支持输出格式：{staging.suffix}")
        if resize is not None and resize.algorithm == ResizeAlgorithm.ANIME_LOW_HALO:
            raise CudaPipelineError("anime_low_halo 暂不支持全 GPU 处理。")

        with _CUDA_CODEC_LOCK, self._cp.cuda.Device(0):
            image = self._decode(source)
            if image.pixels.shape[:2] != (item.after_height, item.after_width):
                algorithm = resize.algorithm if resize else ResizeAlgorithm.LANCZOS3
                image = self._resize(image, (item.after_width, item.after_height), algorithm)
            pixels = self._prepare_for_encode(image, output_format)
            self._encode(staging, pixels, output_format, convert)
            # nvImageCodec may enqueue the device work. Only inspect the file
            # after the stream is synchronized, otherwise a valid encode can be
            # mistaken for an empty staging file on a fast fallback check.
            self._cp.cuda.Stream.null.synchronize()
            if not staging.exists() or staging.stat().st_size == 0:
                raise CudaPipelineError(f"CUDA {output_format.value} 编码未生成有效文件。")

    def _decode(self, source: Path) -> CudaImage:
        nvimgcodec = self._nvimgcodec
        try:
            code_stream = nvimgcodec.CodeStream(str(source))
            params = nvimgcodec.DecodeParams()
            params.apply_exif_orientation = True
            # nvImageCodec defaults some PNG/alpha inputs to RGB. Request RGBA
            # explicitly whenever the coded stream advertises an alpha channel.
            has_alpha = code_stream.num_channels >= 4 or "RGBA" in str(code_stream.sample_format)
            params.sample_format = nvimgcodec.I_RGBA if has_alpha else nvimgcodec.I_RGB
            decoded = self._decoder.read(code_stream, params=params)
            if decoded is None:
                raise CudaPipelineError(f"nvImageCodec 无法解码：{source.name}")
            pixels = self._cp.from_dlpack(decoded.to_dlpack())
            mode = "RGBA" if has_alpha else "RGB"
            if pixels.ndim != 3 or pixels.shape[2] not in (3, 4):
                raise CudaPipelineError(
                    f"nvImageCodec 返回了不支持的像素布局：{tuple(pixels.shape)}"
                )
            return CudaImage(pixels=pixels, mode=mode, codec_image=decoded)
        except CudaPipelineError:
            raise
        except Exception as error:
            raise CudaPipelineError(f"CUDA 图像解码失败：{error}") from error

    def _resize(
        self,
        image: CudaImage,
        target_size: tuple[int, int],
        algorithm: ResizeAlgorithm,
    ) -> CudaImage:
        pixels = image.pixels
        if image.mode == "RGBA":
            pixels = _premultiply_rgba(self._cp, pixels)
        try:
            pixels = resize_array_cuda(pixels, target_size, algorithm)
        except CudaResizeError as error:
            raise CudaPipelineError(str(error)) from error
        if image.mode == "RGBA":
            pixels = _unpremultiply_rgba(self._cp, pixels)
        return CudaImage(pixels=pixels, mode=image.mode, codec_image=image.codec_image)

    def _prepare_for_encode(self, image: CudaImage, output_format: OutputFormat) -> Any:
        if output_format == OutputFormat.JPEG:
            if image.mode == "RGBA":
                return _flatten_rgba(self._cp, image.pixels)
            return image.pixels
        return image.pixels

    def _encode(
        self,
        staging: Path,
        pixels: Any,
        output_format: OutputFormat,
        convert: ConvertOptions | None,
    ) -> None:
        nvimgcodec = self._nvimgcodec
        params = nvimgcodec.EncodeParams()
        quality = convert.quality if convert else 90
        if output_format == OutputFormat.JPEG:
            params.quality_type = nvimgcodec.QUALITY
            params.quality_value = quality
            jpeg_params = nvimgcodec.JpegEncodeParams()
            jpeg_params.optimized_huffman = True
            params.jpeg_params = jpeg_params
            codec = ".jpg"
        elif output_format == OutputFormat.PNG:
            # PNG remains lossless; quality_value maps to the codec's compression
            # level for its lossless backend.
            params.quality_type = nvimgcodec.LOSSLESS
            params.quality_value = 6
            codec = ".png"
        else:
            params.quality_type = nvimgcodec.QUALITY
            params.quality_value = quality
            codec = ".webp"

        try:
            result = self._encoder.write(str(staging), pixels, codec, params=params)
        except Exception as error:
            raise CudaPipelineError(f"CUDA {output_format.value} 编码失败：{error}") from error
        if result is None:
            raise CudaPipelineError(f"CUDA {output_format.value} 编码未返回结果。")


def cuda_pipeline_supports_output(suffix: str, convert: ConvertOptions | None = None) -> bool:
    """Return whether nvImageCodec can encode the requested staging format."""
    return _output_format(suffix, convert) is not None


def _output_format(suffix: str, convert: ConvertOptions | None) -> OutputFormat | None:
    if convert is not None:
        return convert.format
    suffix = suffix.lower()
    if suffix in {".jpg", ".jpeg"}:
        return OutputFormat.JPEG
    if suffix == ".png":
        return OutputFormat.PNG
    if suffix == ".webp":
        return OutputFormat.WEBP
    return None


def _premultiply_rgba(cp: Any, pixels: Any) -> Any:
    rgb = pixels[..., :3].astype(cp.uint16)
    alpha = pixels[..., 3:4].astype(cp.uint16)
    premultiplied = (rgb * alpha + 127) // 255
    return cp.concatenate((premultiplied.astype(cp.uint8), pixels[..., 3:4]), axis=2)


def _unpremultiply_rgba(cp: Any, pixels: Any) -> Any:
    alpha = pixels[..., 3:4].astype(cp.uint16)
    rgb = pixels[..., :3].astype(cp.uint32)
    restored = cp.where(
        alpha == 0,
        0,
        cp.minimum(255, (rgb * 255 + alpha // 2) // alpha),
    ).astype(cp.uint8)
    return cp.concatenate((restored, pixels[..., 3:4]), axis=2)


def _flatten_rgba(cp: Any, pixels: Any) -> Any:
    rgb = pixels[..., :3].astype(cp.uint16)
    alpha = pixels[..., 3:4].astype(cp.uint16)
    flattened = (rgb * alpha + 255 * (255 - alpha) + 127) // 255
    return cp.minimum(255, flattened).astype(cp.uint8)


def cuda_pipeline_status() -> CudaPipelineStatus:
    cp, reason = load_cupy()
    if cp is None:
        return CudaPipelineStatus(False, reason or "CUDA 运行时不可用。")
    try:
        import nvidia.nvimgcodec as nvimgcodec

        nvimgcodec.Decoder(device_id=0)
        nvimgcodec.Encoder(device_id=0)
    except Exception as error:
        return CudaPipelineStatus(False, f"nvImageCodec CUDA 运行时不可用：{error}")
    return CudaPipelineStatus(True, None)
