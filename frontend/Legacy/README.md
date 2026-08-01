# Legacy frontend

This directory contains the complete presentation layer of the original Dataset Annotation Studio
interface. It remains runnable while the new interface is designed and implemented, but it is no
longer the default home for shared business behavior.

## Contents

- `main.tsx`: legacy application bootstrap and legacy global-style entry.
- `legacy/`: root router, desktop titlebar, legacy interaction adapters, and shell hooks.
- `app/`: legacy application mounting, error boundary, and settings center.
- `layouts/`: legacy workspace shell and navigation.
- `pages/`: legacy home, workspace, jobs, preprocessing, export, and preset pages.
- `shared/ui`, `shared/settings`, `shared/theme`: components and appearance systems owned by the
  legacy interface.
- `styles/`: legacy global styles, themes, tokens, and platform-specific visual compatibility.
- `tests/ui/`: UI tests for the legacy presentation layer.

## Dependency boundary

Legacy presentation may depend on reusable code under `../src/application`, `../src/features`, and
the V2-safe parts of `../src/shared`. Code under `../src` must not import Legacy presentation. The
only temporary exception is `../src/main.tsx`, which boots this application until the V2 default
entry exists.

Keep API contracts, backend-query adapters, workflow controllers, persistent stores, and generic
desktop ports under `../src`. New business behavior should be implemented there first and consumed
by Legacy through the same boundary. Do not add a second API client, backend-state mirror, or direct
filesystem protocol inside this directory.

## Entrypoints and assets

`../legacy.html` is the stable fallback URL and loads `Legacy/main.tsx`. `../index.html` currently
reaches the same application through the temporary `src/main.tsx` compatibility bridge. Switching
the product default to V2 should therefore require changing the default bridge, not moving Legacy
again.

Vite-served theme wallpapers remain under `../public/home` because `public` is a build-level asset
root shared by all HTML entries. Their location does not make them available to V2 by default; V2
must explicitly register only assets it is allowed to use.

## Validation

The architecture guard scans both `src/` and `Legacy/`. Run:

```powershell
pnpm --dir frontend check:architecture
pnpm --dir frontend test
pnpm --dir frontend build
```
