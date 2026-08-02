# Dial Archive home theme

`dial-archive` is the formal React implementation of the approved broken-ring archive prototype.
It is a private home-page theme, not a shared V2 component library. Preview it at
`/?home=dial-archive`; `?s=1..6` selects the initial channel for deterministic screenshots.

## Ownership map

```text
DialArchiveHomePage.tsx       interaction orchestration and transition state
components/                   semantic view pieces; no business or API calls
hooks/useDialMotion.ts        imperative requestAnimationFrame spring engine
hooks/usePointerParallax.ts   coalesced pointer input written to private CSS variables
hooks/useCanvasScale.ts       crisp 1920 x 1080 fitting and screen-space chrome metrics
model/spacePresentation.ts    visual metadata joined onto shared HOME_SPACES
model/dialGeometry.ts         pure SVG geometry and channel-to-angle mapping
model/dialMotion.ts           pure spring integration and formatting
styles/                       private tokens, layout, instrument and motion rules
assets/fonts/                 OFL fonts, subset notes and distributable license
```

The shared `v2/navigation/spaceRegistry.ts` remains the only source for stable IDs, labels,
descriptions, routes, ordering and lanes. Theme-private channel codes, ghost labels and layout
roles live in `model/spacePresentation.ts` because they describe this composition only.

## Interaction contract

- The selected, pointer-preview, focus-preview and displayed-content states are separate.
- The ring target reacts immediately. Pointer-driven content waits 56 ms and only commits the
  final stable target, preventing rapid sweeps from flashing the lower-right copy.
- Keyboard focus and commits update content immediately. A commit replays the core bounce/wipe
  and the small information confirmation even when the same space is selected again.
- Only the fixed left-side buttons own hover preview. Moving SVG segments accept focus and commit,
  but never drive hover rotation, so the ring cannot chase its own moving hit geometry.
- At rest, the decorative perimeter and inner calibration rotor turn slowly in opposite directions;
  the black selection rotor stays aligned with the current channel and fixed reader.
- Pointer preview, keyboard focus or a channel change smoothly brakes the idle motion, then hands
  both functional rotors to the existing spring engine. Idle rotation resumes only after the
  interaction settles.
- Motion and pointer parallax write directly to owned SVG nodes or private CSS variables instead of
  causing frame-rate React renders. Reduced-motion mode disables idle rotation, snaps the mechanism
  to its target and suppresses presentation-only sweeps.
- The reference canvas uses layout-level zoom on Chromium/WebView2 so fractional window fitting does
  not resample already-rasterized CJK glyphs. A transform fallback remains for engines without zoom.
- Window-control widths and icon strokes are compensated against the canvas scale, keeping their
  perceived size stable between the default window and fullscreen layouts.

The yellow “进入空间” action currently exercises the approved transition sweep only. V2 has no
second-level route host yet, so this theme deliberately does not redirect to an invented route or
silently mount Legacy inside the new presentation tree. Legacy remains available through the
explicit footer entry.

## Change rules

- Keep all classes, variables, keyframes and asset names under the `dial-archive` prefix or this
  directory.
- Preserve the fixed semantic row and moving `row-surface` split; the surface must retain
  `pointer-events: none`.
- Do not import Legacy presentation code, call `fetch`, query the API, or promote this theme's
  fonts and geometry into neutral V2 styles.
- Add semantic information to `spaceRegistry.ts` only when every home variant needs it. Add visual
  information here.
- Update interaction tests, motion-model tests and 1920 x 1080 / 1366 x 768 browser captures after
  changing hit geometry, timing, spring constants or the reference canvas.
