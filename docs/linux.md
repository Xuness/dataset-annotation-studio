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

If WebKitGTK still shows an invisible or black window, select one compatibility mode
before starting Tauri. Start with the narrowest mode that matches the system:

```bash
# NVIDIA explicit-sync workaround
./启动开发版.sh --graphics nvidia-sync

# Disable only WebKitGTK's DMABUF renderer
./启动开发版.sh --graphics dmabuf-off

# Last resort: disable DMABUF and accelerated compositing
./启动开发版.sh --graphics software
```

Runtime and graphics choices are independent, for example:

```bash
./启动开发版.sh --cuda --graphics dmabuf-off
```

The script passes only the current `DATASET_STUDIO_LINUX_GRAPHICS` mode into Tauri.
Rust applies the corresponding WebKitGTK/NVIDIA environment settings before creating
the webview, so the launcher does not duplicate the older black-screen workaround.
`native` (the default) leaves `DATASET_STUDIO_LINUX_GRAPHICS` unset and changes no
WebKitGTK graphics environment variables.
The `nvidia-sync` and `dmabuf-off` modes retain the full application visuals and
animations. Depending on the installed WebKitGTK version, `dmabuf-off` can move the
webview to a non-accelerated shared-memory presentation path, so it is an opt-in
workaround rather than the Linux default. It does not disable ONNX Runtime CUDA
inference.

`software` is the last-resort mode: it disables accelerated compositing and removes
backdrop blur and large-surface animations, while keeping the selected palette,
wallpaper, and layout.

The selected mode is applied before the Tauri webview is created and injected into the
page before its first paint. An explicitly pre-set `WEBKIT_*` or NVIDIA variable is
never overwritten. The `software` mode can reduce rendering performance, so it should
be used only after the narrower modes fail.

For a niri report, record the niri, WebKitGTK, Mesa/NVIDIA driver, and kernel versions,
whether the session is native Wayland, and which compatibility mode changes the result.

## Filesystem and desktop notes

- The selected dataset directory must be writable. Recovery files and SQLite annotation
  state live under `.annotation-workspace/`; runtime annotation jobs do not write sidecars
  beside the images.
- Linux treats names such as `image.png` and `Image.png` as different files. The
  application preserves that identity on Linux, but such projects may not move cleanly
  to case-insensitive filesystems.
- Closing the main window on Linux requests a safe application exit instead of relying
  on a potentially invisible tray icon. Active file writes and resumable jobs are
  checked before exit.
- The native-decorated Tauri window still needs real desktop testing under niri,
  GNOME/Wayland, and KDE. Until that matrix is complete, Linux remains marked
  experimental.
- The local API and Vite development server use ports `8765` and `5173`. Stop the
  conflicting process if startup reports that either port is occupied.

Set `DATASET_STUDIO_APP_DATA` to an absolute directory only when a custom application
data location is required.
