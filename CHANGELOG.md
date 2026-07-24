# Changelog

This project follows semantic versioning after the first stable release. During the
`0.x` stage, minor versions may include workspace migrations or user-visible workflow
changes.

## Unreleased

- Replaced runtime annotation sidecars with revisioned SQLite channels for imported
  annotations, structured Tags, LLM descriptions, and translations.
- Made Tags immediately confirmed after Tagger or manual writes, with batch confirmation
  for selected legacy, edited, or stale Tag revisions.
- Added project-level Tag assistance beside the prompt settings, exact User Prompt
  previews, and per-asset input revision snapshots for LLM jobs.
- Added channel-aware TXT and JSON export, including independent training variants for
  multi-channel TXT output.
- Prepared the repository for an Apache-2.0 source release.
- Added a CPU-default and CUDA-opt-in source runtime layout.
- Added Linux-aware application data paths, filesystem path identity, credential-store
  diagnostics, portable clipboard fallback, and desktop lifecycle behavior.
- Kept credential-free provider profiles usable when a Linux Secret Service is absent.
- Added explicit third-party model license disclosure and acceptance.

## 0.1.0

- Initial source-preview baseline.
