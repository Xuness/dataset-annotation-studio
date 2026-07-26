# Changelog

This project follows semantic versioning after the first stable release. During the
`0.x` stage, minor versions may include workspace migrations or user-visible workflow
changes.

## Unreleased

- Replaced runtime annotation sidecars with revisioned SQLite channels for imported
  annotations, structured Tags, LLM descriptions, and translations.
- Decoupled current usability from optional human review: validated Tagger, LLM, and
  translation results can immediately feed downstream workflows.
- Added database-backed batch action scopes so users can review or delete Tags, LLM
  descriptions, imported annotations, and individual translation languages explicitly.
- Added project-level Tag assistance beside the prompt settings, exact User Prompt
  previews, and per-asset input revision snapshots for LLM jobs.
- Added channel-aware TXT and JSON export, including independent training variants for
  multi-channel TXT output.
- Hid the imported-annotation editor tab unless the current asset actually contains that
  channel.
- Prepared the repository for an Apache-2.0 source release.
- Added isolated CPU/CUDA source environments with CUDA-first hardware detection and
  matching Windows/Linux launchers.
- Added Linux-aware application data paths, filesystem path identity, credential-store
  diagnostics, portable clipboard fallback, and desktop lifecycle behavior.
- Kept credential-free provider profiles usable when a Linux Secret Service is absent.
- Added explicit third-party model license disclosure and acceptance.
- Unified annotation availability across the asset list, translation workflows, batch
  review, and export, including stale translation-source dependencies.
- Preserved queued job output bases so later manual edits produce visible candidate
  revisions instead of being overwritten.
- Added owner-scoped foreground output leases and relation triggers for annotation and
  job revision integrity.
- Added strict manual-translation structure checks, batched translation candidate
  selection, multi-language per-channel export settings, and lossless Tag draft history.
- Split provider request execution and annotation review persistence out of the worker
  scheduler and general annotation repository.
- Isolated every immutable workspace schema migration in its own versioned module, with
  a small registry and checksum regression guard.
- Added capability-driven image preprocessing backends with dynamic CUDA device
  discovery, JPEG codec acceleration, GPU Lanczos resize, per-item CPU fallback, and
  persisted planned-versus-actual execution diagnostics.
- Added a source-root `dictionaries/` library with ffdkj, WeiLin Prompt, TagComplete CN
  and licyk adapters, license-aware downloads, global correction entries, local
  dictionary translation jobs, per-Tag provenance, and resolution-based stale detection.
- Added a `cpu-paint` Linux graphics mode that keeps accelerated compositing while Skia
  paints on CPU workers, and made it the Linux launcher default after deterministic
  `SkiaGPUWorker` SIGBUS crashes inside Mesa radeonsi on the niri/WebKitGTK 2.52
  desktop.

## 0.1.0

- Initial source-preview baseline.
