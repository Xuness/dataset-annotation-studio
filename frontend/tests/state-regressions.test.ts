import assert from "node:assert/strict";
import test from "node:test";

import { providerCredentialCacheToken } from "../src/features/presets/queryKeys.ts";
import { reconcilePersistedContent } from "../src/pages/workspace/components/annotationEditorState.ts";
import { isFullscreenShortcut } from "../src/shared/desktop/useDesktopWindowBehavior.ts";
import {
  createDefaultPreferences,
  normalizePreferences,
  resolveAppearance,
} from "../src/shared/theme/appearance.ts";
import { DEFAULT_THEME_ID, getThemeDefinition, type ThemeId } from "../src/shared/theme/themes.ts";

test("save reconciliation preserves edits made while the request is pending", () => {
  assert.equal(
    reconcilePersistedContent("new local draft", "submitted draft", "submitted draft"),
    "new local draft",
  );
});

test("save reconciliation accepts the persisted response when the draft did not change", () => {
  assert.equal(
    reconcilePersistedContent("submitted draft", "submitted draft", "normalized draft"),
    "normalized draft",
  );
});

test("provider credential cache tokens distinguish non-empty keys without retaining them", () => {
  const first = providerCredentialCacheToken("secret-key-a");
  const second = providerCredentialCacheToken("secret-key-b");

  assert.notEqual(first, second);
  assert.equal(first.includes("secret-key-a"), false);
  assert.equal(second.includes("secret-key-b"), false);
});

test("fullscreen shortcut accepts only an unmodified first F11 press", () => {
  const f11 = {
    key: "F11",
    repeat: false,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
  };

  assert.equal(isFullscreenShortcut(f11), true);
  assert.equal(isFullscreenShortcut({ ...f11, repeat: true }), false);
  assert.equal(isFullscreenShortcut({ ...f11, ctrlKey: true }), false);
  assert.equal(isFullscreenShortcut({ ...f11, key: "F10" }), false);
});

test("version one appearance preferences migrate without losing the selected theme", () => {
  const preferences = normalizePreferences({ version: 1, themeId: "sea-fog" });

  assert.equal(preferences.version, 3);
  assert.equal(preferences.themeId, "sea-fog");
  assert.equal(preferences.appearance.customBackground, null);
  assert.deepEqual(preferences.appearance.home, { opacity: null, blurPx: null });
  assert.equal(preferences.appearance.transparentRegions.canvas, true);
});

test("fresh appearance preferences use the silent gallery theme", () => {
  const preferences = createDefaultPreferences();
  const resolved = resolveAppearance(preferences);

  assert.equal(DEFAULT_THEME_ID, "silent-gallery");
  assert.equal(preferences.themeId, "silent-gallery");
  assert.equal(resolved.theme.id, "silent-gallery");
  assert.equal(resolved.home.opacity, 0.78);
});

test("theme lookup falls back to the configured default instead of registry order", () => {
  const missingThemeId = "missing-theme" as ThemeId;

  assert.equal(getThemeDefinition(missingThemeId).id, DEFAULT_THEME_ID);
});

test("appearance preferences clamp unsafe values and reject incomplete backgrounds", () => {
  const preferences = normalizePreferences({
    version: 2,
    themeId: "silent-gallery",
    appearance: {
      customBackground: { path: "E:/background.webp" },
      home: { opacity: 4, blurPx: -2 },
      workspace: { opacity: Number.NaN, blurPx: 200 },
    },
  });

  assert.equal(preferences.appearance.customBackground, null);
  assert.deepEqual(preferences.appearance.home, { opacity: 1, blurPx: 0 });
  assert.deepEqual(preferences.appearance.workspace, { opacity: null, blurPx: 32 });
  assert.equal(preferences.appearance.transparentRegions.canvas, true);
});

test("version two appearance preferences keep scene overrides and gain region defaults", () => {
  const preferences = normalizePreferences({
    version: 2,
    themeId: "silent-gallery",
    appearance: {
      customBackground: { path: "E:/background.webp", name: "background.webp" },
      home: { opacity: 0.48, blurPx: 2 },
      workspace: { opacity: 0.18, blurPx: 5 },
    },
  });

  assert.equal(preferences.version, 3);
  assert.equal(preferences.themeId, "silent-gallery");
  assert.deepEqual(preferences.appearance.workspace, { opacity: 0.18, blurPx: 5 });
  assert.equal(preferences.appearance.transparentRegions.canvas, true);
  assert.equal(preferences.appearance.transparentRegions.navigation, false);
});

test("retired version four preferences keep appearance settings without atmosphere motion", () => {
  const preferences = normalizePreferences({
    version: 4,
    themeId: "sea-fog",
    appearance: {
      customBackground: { path: "E:/background.webp", name: "background.webp" },
      atmosphereMotion: false,
      home: { opacity: 0.55, blurPx: 1 },
      workspace: { opacity: 0.28, blurPx: 4 },
      transparentRegions: {
        canvas: false,
        navigation: true,
        "primary-sidebar": true,
        content: false,
        "secondary-sidebar": false,
        chrome: true,
      },
    },
  });

  assert.equal(preferences.version, 3);
  assert.equal(preferences.themeId, "sea-fog");
  assert.deepEqual(preferences.appearance.customBackground, {
    path: "E:/background.webp",
    name: "background.webp",
  });
  assert.equal(Object.hasOwn(preferences.appearance, "atmosphereMotion"), false);
  assert.equal(preferences.appearance.transparentRegions.canvas, false);
  assert.equal(preferences.appearance.transparentRegions.navigation, true);
  assert.deepEqual(preferences.appearance.workspace, { opacity: 0.28, blurPx: 4 });
});

test("region transparency accepts only known boolean values", () => {
  const defaults = createDefaultPreferences("warm-paper");
  const preferences = normalizePreferences({
    ...defaults,
    appearance: {
      ...defaults.appearance,
      transparentRegions: {
        canvas: false,
        navigation: true,
        "primary-sidebar": "yes",
        content: true,
        "secondary-sidebar": true,
        chrome: false,
        unknown: true,
      },
    },
  });

  assert.deepEqual(preferences.appearance.transparentRegions, {
    canvas: false,
    navigation: true,
    "primary-sidebar": false,
    content: true,
    "secondary-sidebar": true,
    chrome: false,
  });
});

test("theme scene defaults remain active until a user override is stored", () => {
  const defaults = createDefaultPreferences("sea-fog");
  const resolvedDefaults = resolveAppearance(defaults);
  const customized = normalizePreferences({
    ...defaults,
    appearance: {
      ...defaults.appearance,
      workspace: { opacity: 0.42, blurPx: 9 },
    },
  });
  const resolvedCustomized = resolveAppearance(customized);

  assert.equal(resolvedDefaults.theme.name, "雨白哥特");
  assert.equal(resolvedDefaults.theme.nativeWindowTheme, "light");
  assert.equal(resolvedDefaults.theme.material.id, "wet-glass");
  assert.equal(resolvedDefaults.theme.material.workspaceSurfaceOpacity, 0.74);
  assert.equal(resolvedDefaults.theme.scene.image, "/home/rainveil-gothic-example.png");
  assert.equal(resolvedDefaults.workspace.opacity, 0.32);
  assert.equal(resolvedDefaults.workspace.blurPx, 0);
  assert.deepEqual(resolvedCustomized.workspace, { opacity: 0.42, blurPx: 9 });
});

test("workspace material opacity is independent from scene visibility", () => {
  const defaults = createDefaultPreferences("sea-fog");
  const customized = normalizePreferences({
    ...defaults,
    appearance: {
      ...defaults.appearance,
      workspace: { opacity: 1, blurPx: null },
    },
  });

  assert.equal(
    resolveAppearance(defaults).theme.material.workspaceSurfaceOpacity,
    resolveAppearance(customized).theme.material.workspaceSurfaceOpacity,
  );
});
