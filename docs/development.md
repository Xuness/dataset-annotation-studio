# Source development

## Toolchains

- Node.js LTS and pnpm through Corepack
- Python 3.11+ and uv
- Rust stable
- Tauri system prerequisites for the host platform
- PowerShell 7 only for the Windows convenience launcher and maintenance scripts

Linux setup is documented separately in [`linux.md`](linux.md).

## Install and run

The convenience launchers select CUDA by default when `nvidia-smi` reports at least one
device. Machines without an NVIDIA CUDA device use the independent CPU environment:

```powershell
# Windows: the VBS/BAT shortcuts call this script in auto mode.
pwsh -NoProfile -File scripts/start-dev.ps1
pwsh -NoProfile -File scripts/start-dev.ps1 -Runtime cuda
pwsh -NoProfile -File scripts/start-dev.ps1 -Runtime cpu
```

```bash
# Linux
./启动开发版.sh
./启动开发版.sh --cuda
./启动开发版.sh --cpu
```

The launchers set `UV_PROJECT_ENVIRONMENT` to `backend/.venv-cuda` or
`backend/.venv-cpu` before exact synchronization and service startup. The mutually
exclusive `onnxruntime` distributions therefore never overwrite one another.
`onnxruntime-gpu` still exposes the CPU Execution Provider, so the CUDA environment
retains per-model and per-image CPU fallback. The CUDA extra also covers CuPy +
nvImageCodec preprocessing.

Normal launcher runs reserve a per-checkout session lock and scan bounded loopback port
ranges before dependency synchronization. Vite prefers `5173` and falls back within
`5173-5199`; the API prefers `8765` and falls back within `8765-8799`. Remote HMR, when
`TAURI_DEV_HOST` is set, uses `5200-5225`. The selected API and frontend ports are passed
through Vite, FastAPI, CORS, and the Tauri `devUrl` as one startup configuration.
Launchers never terminate an occupying process. Check-only mode does not probe ports
because it starts no services.

`DATASET_STUDIO_FRONTEND_PORT`, `DATASET_STUDIO_PORT`, and
`DATASET_STUDIO_HMR_PORT` are strict explicit overrides: startup fails if a requested
port cannot be bound. Set `DATASET_STUDIO_AUTO_PORTS=1` only when those overrides should
be treated as preferences with automatic fallback.

Explicit CUDA selection is strict: missing hardware or a failed CuPy/ONNX Runtime probe
stops startup with a diagnostic. Auto mode chooses CPU only when the NVIDIA device probe
is absent; it does not disguise a broken CUDA installation as a successful GPU launch.

`pnpm dev` and `pnpm dev:cuda` select ports and invoke the CUDA Tauri development
configuration; `pnpm dev:cpu` is the CPU equivalent. The launchers choose between them
after setting the matching environment. All variants start the frontend, loopback API,
durable worker, and Tauri window. The Python services run directly from the selected uv
environment; no sidecar is generated.

## Checks

Set the environment explicitly when running checks outside a launcher process:

```powershell
$env:UV_PROJECT_ENVIRONMENT = "$PWD/backend/.venv-cuda" # or .venv-cpu
pnpm check
```

```bash
export UV_PROJECT_ENVIRONMENT="$PWD/backend/.venv-cuda" # or .venv-cpu
pnpm check
```

The individual gates remain:

```text
node --test scripts/dev-ports.test.mjs
pnpm --dir frontend check
uv run --project backend --no-sync ruff check backend/src backend/tests
uv run --project backend --no-sync pytest
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo check --manifest-path src-tauri/Cargo.toml
```

After selecting and syncing the CUDA extra on a machine with a real NVIDIA device, the
opt-in image backend smoke test exercises variable-shape JPEG batches and premultiplied
alpha resize:

```text
DATASET_STUDIO_RUN_CUDA_TESTS=1 uv run --project backend --no-sync pytest backend/tests/test_cuda_image_runtime_integration.py -q
```

The aggregate `pnpm check` runs all of the above. `cargo check` compiles Rust metadata
and dependencies; it is intentionally separate when only non-compiling validation is
desired.

## Project rules

- Database migrations are immutable after commit. Add a new numbered migration instead
  of editing an existing one.
- Frontend code must not directly mutate dataset files.
- Image and legacy companion-file replacement, SQLite updates, and rollback stay ordered
  in the backend coordinator. Annotation revisions themselves are SQLite-only.
- Remote provider and local tagger task snapshots must remain reproducible after preset
  changes.
- Downloaded models, local datasets, application data, logs, and build outputs must not
  enter Git.

See [`architecture.md`](architecture.md) for module boundaries and
[`workspace-layout.md`](workspace-layout.md) for persisted project files.

## Release packaging

The public project currently promises source distribution only. `pnpm build` and
`pnpm build:cuda` are maintainer-oriented packaging paths and are not part of the first
source release support contract. PyInstaller/Tauri artifacts must be built and tested
separately on each target operating system before they are published.

Packaging performs an exact sync in `backend/.venv-cpu` or `backend/.venv-cuda` before
PyInstaller runs. Stop any source-mode API or worker processes first so Windows can
replace in-use executables.
