# Source development

## Toolchains

- Node.js LTS and pnpm through Corepack
- Python 3.11+ and uv
- Rust stable
- Tauri system prerequisites for the host platform
- PowerShell 7 only for the Windows convenience launcher and maintenance scripts

Linux setup is documented separately in [`linux.md`](linux.md).

## Install and run

Portable CPU baseline:

```text
pnpm install --frozen-lockfile
uv sync --project backend --extra cpu --all-groups --locked --exact
pnpm dev
```

Optional CUDA development:

```text
uv sync --project backend --extra cuda --all-groups --locked --exact
pnpm dev:cuda
```

When switching an existing checkout between the mutually exclusive CPU and CUDA
extras, run `uv venv --clear backend/.venv` before the selected `uv sync` command.

`pnpm dev` starts the frontend, loopback API, durable worker, and Tauri window. The
Python services run directly from the uv environment; no sidecar is generated.
The explicit `uv sync --exact` step selects and cleans the CPU or CUDA runtime once;
development services and checks then use that environment without attempting to rewrite
it while the API and worker are running.

On Windows, `启动开发版.vbs` performs the CPU dependency checks and launches the same
source workflow in the background. The BAT/VBS and `scripts/start-dev.ps1` helpers are
Windows-only conveniences, not the portable entry point.

## Checks

```text
pnpm --dir frontend check
uv run --project backend --no-sync ruff check backend/src backend/tests
uv run --project backend --no-sync pytest
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo check --manifest-path src-tauri/Cargo.toml
```

The aggregate `pnpm check` runs all of the above. `cargo check` compiles Rust metadata
and dependencies; it is intentionally separate when only non-compiling validation is
desired.

## Project rules

- Database migrations are immutable after commit. Add a new numbered migration instead
  of editing an existing one.
- Frontend code must not directly mutate dataset files.
- File replacement, sidecar movement, SQLite updates, and rollback stay ordered in the
  backend coordinator.
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

Packaging performs an exact backend environment sync before PyInstaller runs. Stop any
source-mode API or worker processes first so Windows can replace in-use executables.
