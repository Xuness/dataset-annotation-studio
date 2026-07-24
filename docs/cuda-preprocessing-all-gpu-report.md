# All-GPU image preprocessing and runtime feedback report

**Date:** July 24, 2026

**Scope:** CUDA image preprocessing, device-level runtime feedback, CPU fallback, and
real Tesla V100 validation.

## Summary

The preprocessing path previously exposed CUDA only as an optional resize accelerator and
always reported CPU encoding. This made the preview misleading and left avoidable host/device
copies around the image codec boundary.

This change adds an optional all-GPU path for the supported common formats:

```text
nvImageCodec CUDA decode
        -> CuPy CUDA Lanczos 3/4 resize
        -> GPU pixel buffer
        -> nvImageCodec CUDA encode
        -> atomic staging-file replacement
```

The existing CPU implementation remains the compatibility path. If CUDA, CuPy,
nvImageCodec, an algorithm, a format, or a particular image cannot be processed by the GPU
pipeline, the operation falls back to CPU and reports the reason instead of claiming GPU
execution.

## Implementation

### GPU pipeline

`backend/src/dataset_studio/modules/preprocessing/cuda_pipeline.py` provides the optional
CUDA decode/resize/encode pipeline. It currently covers:

- JPEG, PNG, and WebP input/output;
- RGB and RGBA images;
- EXIF orientation during decode;
- GPU Lanczos 3 and Lanczos 4 resize kernels;
- GPU premultiplied-alpha handling and white-background flattening for JPEG;
- synchronized output validation before the staging file is committed.

The output is still written through the existing recovery and atomic-commit flow. GPU work is
serialized through the codec/context guard, and the full GPU path defaults to one worker to
bound VRAM usage for large images.

`anime_low_halo`, BMP/TIFF output, unavailable CUDA runtimes, unsupported image layouts, and
runtime failures continue through the CPU implementation. A failed CUDA render invalidates the
GPU executor for the current operation and reports a CPU fallback reason.

### Runtime reporting

Runtime selection now tracks these stages independently:

- `decode_device`;
- `resize_device`;
- `encoding_device`;
- `pipeline_device` (`cpu`, `mixed`, or `cuda`).

The preprocessing preview and execution result expose the same information. The UI now shows
whether decoding, resizing, and encoding used CPU or CUDA, the preview duration, the number of
images that require rendering, and the selected worker limit.

### Dependency and launcher changes

The CUDA extra now installs `nvidia-nvimgcodec-cu12[nvjpeg]` in addition to CuPy and the
Volta-compatible cuDNN constraint. `backend/uv.lock` records the resolved nvImageCodec and
nvJPEG wheels.

`启动开发版.sh` adds the NVIDIA Python package library directories to `LD_LIBRARY_PATH` before
starting the CUDA services. `--skip-sync` remains an explicit advanced option: it requires the
selected Python environment to already contain the API and worker entry points.

## Real hardware validation

Validation was performed on:

```text
GPU: Tesla V100-SXM2-16GB
Compute capability: 7.0
Driver: 580.173.02
CuPy: 14.1.1
nvImageCodec: 0.9.0
```

The device was visible to CUDA and basic CuPy execution succeeded:

```text
device_count 1
name b'Tesla V100-SXM2-16GB'
cc 7 0
sum 120.0
```

### Format and mode matrix

The following paths completed successfully with correct output dimensions and modes:

```text
JPEG  -> JPEG  960x540  RGB
PNG   -> PNG   512x384  RGBA
WebP  -> WebP  512x384  RGBA
RGBA  -> JPEG  512x384  RGB (GPU white-background flattening)
```

### Large image stability

Five 4096x4096 to 2048x2048 GPU runs completed without CUDA errors, empty outputs, or
encoder failures:

```text
229.202 ms, 229.727 ms, 238.778 ms, 240.040 ms, 241.363 ms
```

A 32-image continuous GPU batch also completed successfully:

```text
success: 32/32
median: 45.633 ms
p95: 47.264 ms
min/max: 45.363 / 105.563 ms
```

Free VRAM changed by approximately 60 MiB across the batch and returned to a stable level;
`nvidia-smi` reported 1811 MiB in use after completion. No progressive VRAM growth was
observed.

### Service-level validation

A real `PreprocessService.preview()` and `execute()` run processed three images through the
workspace scanner, runtime selection, GPU pipeline, atomic commit, and database rescan.
The reported runtime was:

```json
{
  "decode_device": "cuda",
  "resize_device": "cuda",
  "encoding_device": "cuda",
  "fallback_reason": null,
  "worker_count": 1
}
```

All three output files were valid WebP images with longest edges no greater than 512 pixels.

## Automated checks

The preprocessing regression suite passed:

```text
backend/tests/test_preprocessing.py: 41 passed
```

The existing frontend checks, Ruff checks/formatting, shell syntax check, and `git diff --check`
also passed before submission.

## Known limitation

The nvImageCodec wheel emits optional-plugin warnings when `nvidia-nvjpeg2k-cu12` and
`nvidia-nvtiff-cu12` are not installed. JPEG2000 and TIFF are therefore not part of this CUDA
pipeline yet. JPEG, PNG, and WebP were tested successfully and are unaffected by these warnings.
The optional plugins can be added in a follow-up if GPU JPEG2000/TIFF support is required.
