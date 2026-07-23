# Contributing

Thanks for helping improve Dataset Annotation Studio.

## Before changing code

1. Open an issue for changes that alter persisted workspace formats, provider behavior,
   file replacement semantics, or the supported platform matrix.
2. Keep changes inside the existing module boundaries described in
   [`docs/architecture.md`](docs/architecture.md).
3. Never commit API keys, OAuth material, downloaded model weights, private datasets,
   build output, or local application data.

## Source setup

Use the CPU baseline unless the change specifically targets CUDA:

```text
pnpm install --frozen-lockfile
uv sync --project backend --extra cpu --all-groups --locked
pnpm dev
```

Linux prerequisites and troubleshooting are documented in
[`docs/linux.md`](docs/linux.md). More development commands are in
[`docs/development.md`](docs/development.md).

## Validation

Before submitting a change, run the relevant non-release checks:

```text
pnpm --dir frontend check
uv run --project backend --extra cpu ruff check backend/src backend/tests
uv run --project backend --extra cpu pytest
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
```

Changes to Rust/Tauri behavior should also pass `cargo check` on every claimed platform.
Do not attach generated installers or downloaded model files to a pull request.

Contributions are submitted under the repository's Apache-2.0 license unless explicitly
stated otherwise.
