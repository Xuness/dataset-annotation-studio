# Security policy

## Supported version

The project is currently in its `0.1.x` source-preview stage. Security fixes are applied
to the latest revision on the default branch.

## Reporting a vulnerability

Please use the repository's
[private vulnerability reporting](https://github.com/Xuness/dataset-annotation-studio/security/advisories/new)
instead of opening a public issue. Do not include API keys, OAuth material, private
dataset images, absolute private paths, or unredacted logs in a public report.

Include the affected revision, operating system, reproduction steps, expected impact,
and a minimal redacted example when possible.

## Security boundaries

- The local API listens on `127.0.0.1` by default and is not designed as a LAN service.
- Dataset folders are writable trust boundaries. Do not open untrusted projects without
  reviewing their files and symbolic links.
- Provider credentials are stored through the operating-system credential store.
- Images and prompts leave the machine only when a user selects an external provider.
- Downloaded model weights retain their own licenses and are verified against pinned
  revisions, file sizes, and SHA-256 digests.
