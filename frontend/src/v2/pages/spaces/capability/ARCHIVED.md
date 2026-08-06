# Capability topology prototype archive

The first interactive implementation of space 06 is intentionally sealed in this directory and
its matching theme directory at `themes/dial-archive/spaces/capability`.

- Full connected snapshot: Git commit `ad3ff8b`.
- Current status: retained as source reference, but not mounted by `FrontendRoutes` or
  `DialArchiveSpacePage`.
- Active `/capability` behavior: the shared secondary-space preset with `CONTENT PENDING`.
- The archived `CapabilitySpaceContent` contract is no longer part of the active
  `SpacePageContent` union.

Reconnect this prototype only deliberately. A new space 06 design should establish a new route
and theme entry rather than inheriting these runtime assumptions implicitly.
