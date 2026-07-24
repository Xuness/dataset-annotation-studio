from __future__ import annotations

import threading
from functools import lru_cache
from typing import Any

import numpy as np
from PIL import Image

from dataset_studio.modules.preprocessing.models import ResizeAlgorithm

_SUPPORTED_MODES = {"L", "LA", "RGB", "RGBA"}
_CUDA_LOCK = threading.RLock()


class CudaResizeError(RuntimeError):
    """Raised when the optional CUDA resize backend cannot process an image."""


@lru_cache(maxsize=1)
def load_cupy() -> tuple[Any | None, str | None]:
    try:
        import cupy as cp
    except Exception as error:
        return None, f"未安装或无法加载 CuPy CUDA Runtime：{error}"

    try:
        device_count = cp.cuda.runtime.getDeviceCount()
        if device_count < 1:
            return None, "没有检测到可用的 NVIDIA CUDA 设备。"
        with cp.cuda.Device(0):
            probe = cp.zeros(1, dtype=cp.uint8)
            probe.get()
    except Exception as error:
        return None, f"CUDA 初始化失败：{error}"
    return cp, None


def cuda_resize_status() -> tuple[bool, str | None]:
    cp, reason = load_cupy()
    return cp is not None, reason


def supports_cuda_resize(algorithm: ResizeAlgorithm) -> bool:
    return algorithm in {ResizeAlgorithm.LANCZOS3, ResizeAlgorithm.LANCZOS4}


def resize_image_cuda(
    image: Image.Image,
    target_size: tuple[int, int],
    algorithm: ResizeAlgorithm,
) -> Image.Image:
    if not supports_cuda_resize(algorithm):
        raise CudaResizeError(f"CUDA 缩放暂不支持算法：{algorithm.value}")

    cp, reason = load_cupy()
    if cp is None:
        raise CudaResizeError(reason or "CUDA 缩放运行时不可用。")

    prepared, restore_mode = _prepare_mode(image)
    source = np.asarray(prepared)
    if source.dtype != np.uint8:
        raise CudaResizeError(f"CUDA 缩放暂不支持 {source.dtype} 像素格式。")
    if source.ndim == 2:
        source = source[:, :, None]
    source = np.ascontiguousarray(source)
    source_height, source_width, channels = source.shape
    target_width, target_height = target_size
    lobes = 3 if algorithm == ResizeAlgorithm.LANCZOS3 else 4

    try:
        with _CUDA_LOCK, cp.cuda.Device(0):
            source_gpu = cp.asarray(source)
            horizontal = cp.empty((source_height, target_width, channels), dtype=cp.float32)
            output_gpu = cp.empty((target_height, target_width, channels), dtype=cp.uint8)
            horizontal_kernel, vertical_kernel = _kernels(cp)
            _launch(
                horizontal_kernel,
                source_height * target_width * channels,
                (
                    source_gpu,
                    horizontal,
                    source_width,
                    target_width,
                    source_height,
                    channels,
                    lobes,
                ),
            )
            _launch(
                vertical_kernel,
                target_height * target_width * channels,
                (
                    horizontal,
                    output_gpu,
                    source_height,
                    target_height,
                    target_width,
                    channels,
                    lobes,
                ),
            )
            output = cp.asnumpy(output_gpu)
    except Exception as error:
        raise CudaResizeError(f"CUDA Lanczos 缩放失败：{error}") from error

    if channels == 1:
        output = output[:, :, 0]
    result = Image.frombytes(prepared.mode, target_size, output.tobytes())
    if restore_mode is not None:
        result = result.convert(restore_mode)
    result.info = image.info.copy()
    return result


def _prepare_mode(image: Image.Image) -> tuple[Image.Image, str | None]:
    if image.mode not in _SUPPORTED_MODES:
        raise CudaResizeError(f"CUDA 缩放暂不支持 {image.mode} 图片模式。")
    if image.mode == "RGBA":
        return image.convert("RGBa"), "RGBA"
    if image.mode == "LA":
        return image.convert("La"), "LA"
    return image, None


def _launch(kernel: Any, item_count: int, arguments: tuple[object, ...]) -> None:
    threads = 256
    blocks = (item_count + threads - 1) // threads
    kernel((blocks,), (threads,), arguments)


@lru_cache(maxsize=1)
def _kernels(cp: Any) -> tuple[Any, Any]:
    source = r"""
    extern "C" {
    __device__ float sinc_pi(float value) {
        if (fabsf(value) < 1.0e-6f) return 1.0f;
        const float pi_value = 3.14159265358979323846f * value;
        return sinf(pi_value) / pi_value;
    }

    __device__ float lanczos_weight(float distance, int lobes) {
        const float absolute = fabsf(distance);
        if (absolute >= (float)lobes) return 0.0f;
        return sinc_pi(distance) * sinc_pi(distance / (float)lobes);
    }

    __global__ void resize_horizontal(
        const unsigned char* source,
        float* target,
        int source_width,
        int target_width,
        int height,
        int channels,
        int lobes
    ) {
        const int index = blockDim.x * blockIdx.x + threadIdx.x;
        const int total = height * target_width * channels;
        if (index >= total) return;
        const int channel = index % channels;
        const int target_x = (index / channels) % target_width;
        const int y = index / (channels * target_width);
        const float ratio = (float)source_width / (float)target_width;
        const float filter_scale = ratio > 1.0f ? 1.0f / ratio : 1.0f;
        const float support = (float)lobes / filter_scale;
        const float center = ((float)target_x + 0.5f) * ratio - 0.5f;
        const int first = (int)ceilf(center - support);
        const int last = (int)floorf(center + support);
        float weighted = 0.0f;
        float weight_sum = 0.0f;
        for (int source_x = first; source_x <= last; ++source_x) {
            int clamped_x = source_x;
            if (clamped_x < 0) clamped_x = 0;
            if (clamped_x >= source_width) clamped_x = source_width - 1;
            const float weight = lanczos_weight((center - (float)source_x) * filter_scale, lobes);
            weighted += weight * (float)source[(y * source_width + clamped_x) * channels + channel];
            weight_sum += weight;
        }
        target[index] = weight_sum == 0.0f ? 0.0f : weighted / weight_sum;
    }

    __global__ void resize_vertical(
        const float* source,
        unsigned char* target,
        int source_height,
        int target_height,
        int width,
        int channels,
        int lobes
    ) {
        const int index = blockDim.x * blockIdx.x + threadIdx.x;
        const int total = target_height * width * channels;
        if (index >= total) return;
        const int channel = index % channels;
        const int x = (index / channels) % width;
        const int target_y = index / (channels * width);
        const float ratio = (float)source_height / (float)target_height;
        const float filter_scale = ratio > 1.0f ? 1.0f / ratio : 1.0f;
        const float support = (float)lobes / filter_scale;
        const float center = ((float)target_y + 0.5f) * ratio - 0.5f;
        const int first = (int)ceilf(center - support);
        const int last = (int)floorf(center + support);
        float weighted = 0.0f;
        float weight_sum = 0.0f;
        for (int source_y = first; source_y <= last; ++source_y) {
            int clamped_y = source_y;
            if (clamped_y < 0) clamped_y = 0;
            if (clamped_y >= source_height) clamped_y = source_height - 1;
            const float weight = lanczos_weight((center - (float)source_y) * filter_scale, lobes);
            weighted += weight * source[(clamped_y * width + x) * channels + channel];
            weight_sum += weight;
        }
        float value = weight_sum == 0.0f ? 0.0f : weighted / weight_sum;
        value = fminf(255.0f, fmaxf(0.0f, value));
        target[index] = (unsigned char)(value + 0.5f);
    }
    }
    """
    return (
        cp.RawKernel(source, "resize_horizontal"),
        cp.RawKernel(source, "resize_vertical"),
    )
