# Linux source guide

Linux support is currently an experimental source workflow. The initial target is
x86_64 Ubuntu 22.04 or newer and comparable Debian-based desktop distributions. ARM64,
headless sessions, and packaged Linux artifacts are not yet claimed as supported.

Running from source still compiles the Rust/Tauri desktop shell on the local machine.
The repository does not currently publish AppImage, DEB, RPM, or prebuilt Python
sidecars.

## System dependencies

Install the current Tauri 2 development prerequisites on Ubuntu or Debian:

```bash
sudo apt update
sudo apt install \
  libwebkit2gtk-4.1-dev \
  build-essential \
  curl \
  wget \
  file \
  libxdo-dev \
  libssl-dev \
  libayatana-appindicator3-dev \
  librsvg2-dev \
  zlib1g
```

Then install:

- Node.js LTS with Corepack/pnpm
- Python 3.11 or newer
- [uv](https://docs.astral.sh/uv/getting-started/installation/)
- Rust stable through [rustup](https://rustup.rs/)

The upstream package list for other distributions is maintained in the
[Tauri prerequisites](https://v2.tauri.app/start/prerequisites/).

## Source launcher

```bash
corepack enable
chmod +x ./启动开发版.sh
./启动开发版.sh
```

The launcher uses `backend/.venv-cuda` when `nvidia-smi` reports a CUDA device and
`backend/.venv-cpu` otherwise. The environments remain independent, so starting on a
CPU-only machine never removes CUDA packages from another environment. The first run
downloads dependencies and compiles the desktop shell; Vite, the FastAPI service, and
the task worker remain attached to the terminal and stop together.

Before synchronizing dependencies, a normal launch scans bounded loopback ranges. Vite
prefers `5173` and falls back within `5173-5199`; the API prefers `8765` and falls back
within `8765-8799`. The launcher passes the selected ports consistently to Vite,
FastAPI/CORS, and Tauri. It never terminates an occupying process. `--check-only`
continues to validate the environment without probing development ports.

Explicit overrides and validation modes are available:

```text
./启动开发版.sh --cuda
./启动开发版.sh --cpu
./启动开发版.sh --cuda --check-only
./启动开发版.sh --cuda --skip-sync
```

The CPU and CUDA ONNX Runtime packages are intentionally conflicting choices and must
not be installed together in one environment. The CUDA environment uses
`onnxruntime-gpu`, which still provides CPU operator fallback, and also installs the
NVIDIA runtime wheels, CuPy, and nvImageCodec. The launcher exposes wheel-provided
NVIDIA library directories through `LD_LIBRARY_PATH` before probing or starting the
services. Review NVIDIA package terms before redistributing an environment or derived
binary.

## Application data and credentials

The default application data directory is:

```text
${XDG_DATA_HOME:-$HOME/.local/share}/DatasetAnnotationStudio
```

It contains `global.sqlite3`, logs, caches, and the default managed tagger library.
Dataset-specific state remains inside the selected dataset's
`.annotation-workspace/` directory.

API keys and saved Hugging Face connection secrets require a working Freedesktop
Secret Service, such as GNOME Keyring or KWallet, in the current desktop/DBus session.
If it is unavailable, the application reports an actionable error instead of writing
plaintext credentials. `HF_TOKEN`, a local Hugging Face login, and environment proxy
variables remain available for model downloads.

## Wayland and WebKitGTK graphics compatibility

Linux uses the compositor's native window decorations, while the application content
keeps the same theme materials, wallpaper, transparency controls, and immersive-mode
presentation as Windows. The native title bar itself follows the desktop environment
instead of the application's custom title-bar theme.

The Linux launcher defaults to the `cpu-paint` graphics mode. WebKitGTK 2.46 and newer
paint web content with Skia on GPU worker threads; on at least one validated desktop
(niri 26.04, Mesa 26.1.5 radeonsi on a Radeon RX 5500, WebKitGTK 2.52.5) that painting
path intermittently kills the web process with `SIGBUS` inside Mesa on a
`SkiaGPUWorker` thread, which appears as a black or frozen window after some time.
Recorded coredumps across several days crash at identical driver offsets, so the
failure is a deterministic driver-path defect rather than a load or memory problem.
`cpu-paint` sets `WEBKIT_SKIA_ENABLE_CPU_RENDERING=1` so Skia paints tiles on CPU
worker threads while accelerated compositing and DMA-BUF presentation stay enabled:
themes, blur, and animations remain identical to `native`, and CUDA inference or GPU
image preprocessing is unaffected because the webview only ever renders on the
display GPU.

If a different mode matches the system better, select it before starting Tauri:

```bash
# Upstream WebKitGTK rendering path, including Skia GPU painting
./启动开发版.sh --graphics native

# NVIDIA explicit-sync workaround
./启动开发版.sh --graphics nvidia-sync

# Disable only WebKitGTK's DMABUF renderer
./启动开发版.sh --graphics dmabuf-off

# Last resort: disable DMABUF and accelerated compositing
./启动开发版.sh --graphics software
```

Runtime and graphics choices are independent, for example:

```bash
./启动开发版.sh --cuda --graphics native
```

The script passes only the current `DATASET_STUDIO_LINUX_GRAPHICS` mode into Tauri.
Rust applies the corresponding WebKitGTK/NVIDIA environment settings before creating
the webview, so the launcher does not duplicate the older black-screen workaround.
`native` leaves `DATASET_STUDIO_LINUX_GRAPHICS` unset and changes no WebKitGTK
graphics environment variables.
The `cpu-paint`, `nvidia-sync`, and `dmabuf-off` modes retain the full application
visuals and animations. `dmabuf-off` disables only the DMA-BUF buffer transport
between WebKit processes; it does not disable Skia GPU painting, so it cannot address
the `SkiaGPUWorker` crash class that `cpu-paint` targets — the two workarounds cover
independent layers. Depending on the installed WebKitGTK version, `dmabuf-off` can
move the webview to a non-accelerated shared-memory presentation path, so it is an
opt-in workaround. It does not disable ONNX Runtime CUDA inference.

`software` is the last-resort mode: it disables accelerated compositing and removes
backdrop blur and large-surface animations, while keeping the selected palette,
wallpaper, and layout.

The selected mode is applied before the Tauri webview is created and injected into the
page before its first paint. An explicitly pre-set `WEBKIT_*` or NVIDIA variable is
never overwritten. The `software` mode can reduce rendering performance, so it should
be used only after the narrower modes fail.

For a niri report, record the niri, WebKitGTK, Mesa/NVIDIA driver, and kernel versions,
whether the session is native Wayland, and which compatibility mode changes the result.
If a session still freezes while rendering stays otherwise stable, testing with
`WEBKIT_FORCE_VBLANK_TIMER=1` (WebKitGTK 2.52+) is worth recording in the report; it
replaces the DRM vblank wait with a timer-driven frame clock.

## Filesystem and desktop notes

- The selected dataset directory must be writable. Recovery files and SQLite annotation
  state live under `.annotation-workspace/`; runtime annotation jobs do not write sidecars
  beside the images.
- Linux treats names such as `image.png` and `Image.png` as different files. The
  application preserves that identity on Linux, but such projects may not move cleanly
  to case-insensitive filesystems.
- Closing the main window on Linux requests a safe application exit instead of relying
  on a potentially invisible tray icon. Active file writes and resumable jobs are
  checked before exit. If the frontend never loads or cannot acknowledge the native
  close request, Tauri exits after a short fallback delay so a black startup window is
  not left permanently open.
- The native-decorated Tauri window still needs real desktop testing under niri,
  GNOME/Wayland, and KDE. Until that matrix is complete, Linux remains marked
  experimental.
- The local API and Vite development server prefer ports `8765` and `5173`, respectively,
  and automatically fall back within their documented development ranges. Explicit
  `DATASET_STUDIO_PORT` or `DATASET_STUDIO_FRONTEND_PORT` values remain strict. The
  launcher never kills a conflicting process.

Set `DATASET_STUDIO_APP_DATA` to an absolute directory only when a custom application
data location is required.
