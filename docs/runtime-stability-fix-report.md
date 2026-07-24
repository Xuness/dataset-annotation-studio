# Runtime recovery and Linux graphics stability fix report

**Date:** July 24, 2026

**Scope:** local tagger download recovery, CUDA inference compatibility, and Linux Tauri rendering

## Summary

Three runtime failures were investigated together because they could leave the local tagger
workflow unusable even though the application itself still opened:

1. an interrupted CL Tagger download could not be resumed from its catalog card;
2. CUDA inference on a Tesla V100 failed in the first vision encoder convolution with a
   `CUDNN_BACKEND_API_FAILED` error;
3. WebKitGTK could intermittently render a black window, while the safer `dmabuf-off` mode
   made large blur and route-transition animations noticeably less smooth.

The fixes keep model downloads resumable, constrain the CUDA environment to a Volta-compatible
cuDNN release, and separate Linux renderer compatibility from the immersive/non-immersive
appearance system. No model weights, user data, or appearance preferences are migrated or
removed.

## Incident 1: interrupted tagger downloads

### Symptom

The download center showed CL Tagger as interrupted, but the primary catalog action remained
disabled. The user could not use the same card to continue the existing task.

### Cause

The catalog button treated every non-completed task as a reason to disable a new download. It did
not distinguish an active task from a resumable task, even though the backend already exposed
`can_resume` and a resume endpoint.

### Fix

- When the latest task has `can_resume`, the catalog action becomes **Continue download**.
- The action calls the existing task resume mutation instead of creating a second task.
- Active, installed, or otherwise non-resumable tasks remain protected from duplicate starts.
- A UI regression test covers the interrupted-to-queued transition and the resume API request.

## Incident 2: ONNX Runtime CUDA failure on Tesla V100

### Symptom

CL Tagger failed at the first patch-embedding convolution:

```text
CUDNN_FE failure 11: CUDNN_BACKEND_API_FAILED
/vision_encoder/embeddings/patch_embedding/Conv
```

The runtime then reported that the current local inference runtime was unavailable.

### Cause

The CUDA extra allowed uv to resolve a newer cuDNN 9 release that no longer supports the Volta
architecture used by Tesla V100 (compute capability 7.0). A previously synchronized environment
could also retain packages from the opposite CPU/CUDA extra.

### Fix

- Pin `nvidia-cudnn-cu12` to `>=9.10,<9.11` in the CUDA extra and lock cuDNN 9.10.2.21.
- Use uv exact synchronization for development, checks, and sidecar builds so stale CPU/GPU
  runtime packages are removed instead of silently retained.
- Update source-development documentation to use `--exact` for CPU and CUDA environments.

### Hardware smoke test

The installed CL Tagger v2 model was loaded and executed on a Tesla V100-SXM2-16GB with
ONNX Runtime GPU 1.26.0 and cuDNN 9.10.2.21:

```text
providers=CUDAExecutionProvider,CPUExecutionProvider
output_shape=(1, 108139)
output_finite=True
```

This exercises the convolution that previously failed, not only provider discovery.

## Incident 3: Linux black window and animation stutter

### Black-window diagnosis

A WebKit web-process coredump showed a `SIGBUS` in a `SkiaGPUWorker` thread with WebKitGTK and
Mesa Gallium frames. This is a webview rendering failure rather than a CUDA inference failure.
The existing `dmabuf-off` mode remains the narrow workaround:

```bash
DATASET_STUDIO_LINUX_GRAPHICS=dmabuf-off pnpm dev:cuda
```

It sets `WEBKIT_DISABLE_DMABUF_RENDERER=1` before the Tauri webview is created and does not disable
CUDA inference.

### Appearance separation

The earlier Linux compatibility stylesheet coupled renderer safety to appearance by disabling
blur, transparency, and animations. The stylesheet now only removes the unused custom-titlebar
layout row. Immersive mode, non-immersive per-region transparency, scene blur, and animations are
again controlled by the shared appearance settings on every platform.

### Performance fix for `dmabuf-off`

The restored effects exposed two unnecessary high-cost rendering paths:

- Linux native decorations still emitted the `desktop-titlebar` transparency token. That made an
  invisible web titlebar take ownership of a filtered full-window scene and replace it on route
  changes.
- Surface state changes interpolated `backdrop-filter`, and the home route faded the complete page,
  including its full-screen filtered scene, for 700 ms.

The optimized path now:

- excludes only `desktop-titlebar` from rendered transparency tokens when native decorations are
  active, without changing the saved preference;
- keeps final blur values but no longer interpolates `backdrop-filter` frame by frame;
- animates home content for 280 ms while leaving the large scene layer static;
- adds paint containment to the home and workspace scene containers.

This preserves the complete immersive/non-immersive visual system while reducing full-window
rasterization and route-switch composition work.

## Validation

The following checks were run on the repaired tree:

- `pnpm --dir frontend check`
  - formatting passed;
  - state regression tests passed;
  - 21 UI tests passed;
  - TypeScript and ESLint passed.
- Backend Ruff checks passed.
- Backend pytest suite passed after making the Windows-style migration test select its intended
  case-insensitive path policy explicitly.
- `cargo test --manifest-path src-tauri/Cargo.toml`: 9 tests passed.
- `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check` passed.
- `cargo check --manifest-path src-tauri/Cargo.toml` passed.
- `git diff --check` passed apart from existing Git line-ending notices for PowerShell files.
- Real CL Tagger CUDA inference completed successfully on Tesla V100.

## Compatibility and rollback

- CPU remains the default runtime extra.
- CUDA users on newer architectures can still use cuDNN 9.10 through ONNX Runtime GPU.
- The renderer modes remain opt-in: `default`, `nvidia-sync`, `dmabuf-off`, and `software`.
- `software` remains the broadest fallback and may reduce rendering performance.
- Removing the `DATASET_STUDIO_LINUX_GRAPHICS` environment variable returns WebKitGTK to its
  default renderer without changing any appearance preference.
