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
  librsvg2-dev
```

Then install:

- Node.js LTS with Corepack/pnpm
- Python 3.11 or newer
- [uv](https://docs.astral.sh/uv/getting-started/installation/)
- Rust stable through [rustup](https://rustup.rs/)

The upstream package list for other distributions is maintained in the
[Tauri prerequisites](https://v2.tauri.app/start/prerequisites/).

## CPU source run

```bash
corepack enable
pnpm install --frozen-lockfile
uv sync --project backend --extra cpu --all-groups --locked --exact
pnpm dev
```

The first `pnpm dev` compiles the desktop shell. Vite, the FastAPI service, and the task
worker remain attached to the terminal and stop together.

## Optional NVIDIA CUDA runtime

CPU is the portable default. On an x86_64 NVIDIA system with a compatible driver:

```bash
uv sync --project backend --extra cuda --all-groups --locked --exact
pnpm dev:cuda
```

The CPU and CUDA ONNX Runtime packages are intentionally conflicting choices and must
not be installed together. The CUDA extra also installs NVIDIA runtime wheels; review
their terms before redistributing an environment or a derived binary.

When changing an existing checkout between CPU and CUDA, rebuild the project virtual
environment first so files shared by the two ONNX Runtime distributions cannot remain
mixed:

```bash
uv venv --clear backend/.venv
uv sync --project backend --extra cpu --all-groups --locked --exact
```

Replace `cpu` with `cuda` in the second command when that is the intended runtime. This
clears only the repository-local dependency environment, not datasets or application
data.

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

Linux uses the compositor's native window decorations, but keeps the same appearance
system as Windows and macOS. Immersive mode, non-immersive per-region transparency,
scene blur, and application animations remain controlled by the settings UI. The Linux
stylesheet only removes the unused custom-titlebar layout row.

WebKitGTK renderer compatibility is configured independently and does not change those
appearance preferences. If WebKitGTK shows an invisible or black window, select one
compatibility mode before starting Tauri. Start with the narrowest mode that matches the
system:

```bash
# NVIDIA explicit-sync workaround
DATASET_STUDIO_LINUX_GRAPHICS=nvidia-sync pnpm dev

# Disable only WebKitGTK's DMABUF renderer
DATASET_STUDIO_LINUX_GRAPHICS=dmabuf-off pnpm dev

# Last resort: disable DMABUF and accelerated compositing
DATASET_STUDIO_LINUX_GRAPHICS=software pnpm dev
```

For CUDA development, use the same prefix with `pnpm dev:cuda`, for example:

```bash
DATASET_STUDIO_LINUX_GRAPHICS=dmabuf-off pnpm dev:cuda
```

`default` (or an unset variable) changes no WebKitGTK graphics environment variables.
The selected flags are applied before the Tauri webview is created, and an explicitly
pre-set `WEBKIT_*` or NVIDIA variable is never overwritten. None of these modes changes
immersive mode, region transparency, scene blur, animations, or CUDA inference. The
`software` mode can reduce rendering performance, so it should be used only after the
narrower modes fail.

For a niri report, record the niri, WebKitGTK, Mesa/NVIDIA driver, and kernel versions,
whether the session is native Wayland, and which compatibility mode changes the result.

## Filesystem and desktop notes

- The selected dataset directory must be writable. Recovery files, SQLite state, and
  annotation sidecars are stored beside the images.
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
