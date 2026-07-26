# Runtime recovery and Linux graphics stability fix report

**Date:** July 24, 2026

**Scope:** local tagger download recovery, CUDA inference compatibility, and Linux Tauri
rendering

**Contribution:** selectively integrated from
[PR #2 by BuXinZi](https://github.com/Xuness/dataset-annotation-studio/pull/2) together
with the existing Linux WebKitGTK hardening work.

## Summary

Three runtime failures were reviewed together:

1. an interrupted Hugging Face tagger download remained visible but could not be resumed
   from its catalog card;
2. CUDA inference on a Tesla V100 failed in the first vision-encoder convolution with
   `CUDNN_BACKEND_API_FAILED`;
3. WebKitGTK could intermittently render a black window under niri, while the original
   Linux compatibility stylesheet also reduced the application's appearance by default.

The combined fix keeps downloads resumable, constrains the CUDA environment to the last
cuDNN series that supports Volta, and separates WebKitGTK renderer workarounds from the
normal appearance system.

## Interrupted tagger downloads

The backend already exposes durable task state, `can_resume`, and a resume endpoint. The
catalog action previously disabled itself whenever any unfinished task existed, including
paused, failed, or interrupted tasks that the backend explicitly marked as resumable.

The catalog card now:

- shows **Continue download** for a resumable task;
- resumes the existing task rather than creating a duplicate;
- keeps active, installed, and non-resumable tasks protected from duplicate starts;
- shares the same resume action with the detailed task list.

The accepted license and audited immutable model revision remain attached to the existing
task.

## CUDA runtime compatibility

The CUDA extra previously allowed the transitive cuDNN dependency to advance beyond the
last release supporting Tesla V100/Volta. It now directly constrains
`nvidia-cudnn-cu12` to `>=9.10,<9.11`, resolving cuDNN 9.10.2.21.

NVIDIA's
[cuDNN 9.10 support matrix](https://docs.nvidia.com/deeplearning/cudnn/backend/v9.10.0/reference/support-matrix.html)
lists compute capability 7.0 and Volta as supported. The PR contributor also reported a
real CL Tagger v2 smoke test on a Tesla V100-SXM2-16GB using ONNX Runtime GPU 1.26.0:

```text
providers=CUDAExecutionProvider,CPUExecutionProvider
output_shape=(1, 108139)
output_finite=True
```

CPU and CUDA extras are mutually exclusive. Explicit setup, the Windows launcher, and
sidecar builds use uv exact synchronization so packages left by the opposite runtime
extra are removed instead of remaining in the shared project environment. Development
services and checks use the already-selected environment with `--no-sync`, avoiding
concurrent rewrites while the API and worker executables are running.

## Linux black windows

### Renderer failure boundary

The reported web-process coredump contained a `SIGBUS` in a `SkiaGPUWorker` thread with
WebKitGTK and Mesa Gallium frames. This places the failure in webview rendering rather
than ONNX Runtime or CUDA inference.

The narrow workaround remains:

```bash
DATASET_STUDIO_LINUX_GRAPHICS=dmabuf-off pnpm dev
```

It sets `WEBKIT_DISABLE_DMABUF_RENDERER=1` before Tauri creates the webview. Depending on
the installed WebKitGTK version, this can move presentation to a non-accelerated
shared-memory path. It does not disable model inference through CUDA. The broader
`software` mode remains the final fallback.

WebKit's
[graphics documentation](https://docs.webkit.org/Ports/WebKitGTK%20and%20WPE%20WebKit/Graphics.html)
describes DMA-BUF transport for accelerated WebKitGTK frames and shared-memory transport
for the non-accelerated path.

### Appearance preservation

Linux uses native window decorations, so the hidden custom web title bar must not own the
application scene. Rendered transparency tokens now exclude only `desktop-titlebar` when
the application is actually running in Tauri with native decorations. The stored
preference is not changed, and Linux browser builds keep normal web behavior.

The unused full-window custom-titlebar scene layers are not painted on Linux, and the
home and workspace scene containers use paint containment to bound invalidation.

These changes intentionally preserve the existing shared visual behavior:

- Windows and normal Linux modes keep the same themes, wallpaper, blur, transparency,
  immersive mode, and 700 ms home reveal;
- `backdrop-filter` transitions are not shortened or removed;
- `default`, `nvidia-sync`, and `dmabuf-off` do not apply CSS visual degradation;
- only the explicitly selected `software` mode removes high-cost blur and large-surface
  animations.

The PR's proposed global 280 ms content reveal and removal of blur interpolation were not
adopted because they would also alter the existing Windows animation presentation.

## Platform-stable migration test

The migration regression that uses Windows-style `E:\Dataset` and `e:\dataset` paths now
selects the case-insensitive path policy explicitly. This keeps the test's intended
expectation identical on Windows and Linux without changing production filesystem
identity rules.

## Validation

The combined tree passed:

- frontend formatting, TypeScript, and ESLint;
- 38 frontend state tests and 20 UI tests;
- backend Ruff and pytest: 205 passed, 4 skipped;
- uv lock verification and a locked CUDA exact-sync dry run resolving cuDNN
  9.10.2.21;
- Rust formatting and checks, plus 8 tests passed and 1 real-clipboard test
  intentionally ignored;
- a production frontend build.

The Linux renderer modes still require validation on the affected niri/WebKitGTK/driver
combination because a Windows development host cannot reproduce that graphics stack.

## Follow-up: Skia GPU painting crashes (July 26, 2026)

Continued use of the July 24 tree on the affected niri desktop still produced black or
frozen windows in the default graphics mode. `coredumpctl` recorded eight
`WebKitWebProcess` crashes over three days (seven `SIGBUS`, one `SIGABRT`); every
`SIGBUS` terminated a `SkiaGPUWorker` thread inside `libgallium` (Mesa 26.1.5 radeonsi,
Radeon RX 5500, WebKitGTK 2.52.5), with identical crash offsets across days. The
failure is therefore a deterministic defect in the Skia GPU painting path, not a load
or memory condition, and it is unrelated to the CUDA runtime: the Tesla V100 exposes no
DRM render node, so the web process only ever touches the display GPU.

`dmabuf-off` cannot address this class because `WEBKIT_DISABLE_DMABUF_RENDERER`
disables the buffer transport between WebKit processes while Skia GPU painting keeps
running. The new `cpu-paint` mode instead sets `WEBKIT_SKIA_ENABLE_CPU_RENDERING=1`
before the webview is created, moving tile painting to Skia CPU workers while
accelerated compositing, DMA-BUF presentation, and the full visual system stay
enabled. The Linux launcher now defaults to `cpu-paint`; `--graphics native` restores
the upstream rendering path.

On the affected desktop, a launcher start with the new default selected the CUDA
runtime with `cpu-paint`, and the web process environment contained
`WEBKIT_SKIA_ENABLE_CPU_RENDERING=1`. The process ran eight `SkiaCPUWorker` threads,
no `SkiaGPUWorker` thread, and the threaded compositor remained active, which removes
the crashing code path while keeping composited visuals.
