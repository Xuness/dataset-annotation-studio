import assert from "node:assert/strict";
import test from "node:test";

import { providerCredentialCacheToken } from "../src/features/presets/queryKeys.ts";
import { reconcilePersistedContent } from "../src/pages/workspace/components/annotationEditorState.ts";
import { isFullscreenShortcut } from "../src/shared/desktop/useDesktopWindowBehavior.ts";
import {
  createDefaultPreferences,
  normalizePreferences,
  resolveAppearance,
  resolveSurfaceTransparency,
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

  assert.equal(preferences.version, 9);
  assert.equal(preferences.themeId, "sea-fog");
  assert.deepEqual(preferences.appearance.customBackgrounds, {});
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

  assert.deepEqual(preferences.appearance.customBackgrounds, {});
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

  assert.equal(preferences.version, 9);
  assert.equal(preferences.themeId, "silent-gallery");
  assert.deepEqual(preferences.appearance.customBackgrounds["silent-gallery"], {
    path: "E:/background.webp",
    name: "background.webp",
  });
  assert.deepEqual(preferences.appearance.workspace, { opacity: 0.18, blurPx: 5 });
  assert.equal(preferences.appearance.transparentRegions.canvas, true);
  assert.equal(preferences.appearance.transparentRegions.navigation, false);
});

test("version three appearance preferences keep transparency and gain disabled immersive mode", () => {
  const preferences = normalizePreferences({
    version: 3,
    themeId: "silent-gallery",
    appearance: {
      customBackground: null,
      home: { opacity: null, blurPx: null },
      workspace: { opacity: 0.34, blurPx: 2 },
      transparentRegions: {
        canvas: true,
        navigation: true,
        "primary-sidebar": false,
        content: true,
        "secondary-sidebar": false,
        chrome: false,
      },
    },
  });

  assert.equal(preferences.version, 9);
  assert.equal(preferences.appearance.immersiveMode, false);
  assert.equal(preferences.appearance.transparentRegions["desktop-titlebar"], false);
  assert.equal(preferences.appearance.transparentRegions["home-topbar"], false);
  assert.equal(preferences.appearance.transparentRegions.navigation, true);
  assert.equal(preferences.appearance.transparentRegions.content, true);
  assert.deepEqual(preferences.appearance.workspace, { opacity: 0.34, blurPx: 2 });
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

  assert.equal(preferences.version, 9);
  assert.equal(preferences.themeId, "sea-fog");
  assert.deepEqual(preferences.appearance.customBackgrounds["sea-fog"], {
    path: "E:/background.webp",
    name: "background.webp",
  });
  assert.equal(Object.hasOwn(preferences.appearance, "atmosphereMotion"), false);
  assert.equal(preferences.appearance.immersiveMode, false);
  assert.equal(preferences.appearance.transparentRegions["desktop-titlebar"], false);
  assert.equal(preferences.appearance.transparentRegions["home-topbar"], false);
  assert.equal(preferences.appearance.transparentRegions.canvas, false);
  assert.equal(preferences.appearance.transparentRegions.navigation, true);
  assert.deepEqual(preferences.appearance.workspace, { opacity: 0.28, blurPx: 4 });
});

test("version five preferences preserve immersive mode and gain titlebar transparency", () => {
  const preferences = normalizePreferences({
    version: 5,
    themeId: "sea-fog",
    appearance: {
      customBackground: null,
      home: { opacity: 0.64, blurPx: 0 },
      workspace: { opacity: 0.38, blurPx: 3 },
      immersiveMode: true,
      transparentRegions: {
        canvas: false,
        navigation: true,
        "primary-sidebar": true,
        content: false,
        "secondary-sidebar": true,
        chrome: true,
      },
    },
  });

  assert.equal(preferences.version, 9);
  assert.equal(preferences.appearance.immersiveMode, true);
  assert.equal(preferences.appearance.transparentRegions["desktop-titlebar"], false);
  assert.equal(preferences.appearance.transparentRegions["home-topbar"], false);
  assert.equal(preferences.appearance.transparentRegions.navigation, true);
  assert.deepEqual(preferences.appearance.workspace, { opacity: 0.38, blurPx: 3 });
});

test("version six preferences preserve titlebar and immersive choices and gain home navigation transparency", () => {
  const preferences = normalizePreferences({
    version: 6,
    themeId: "silent-gallery",
    appearance: {
      customBackground: { path: "E:/background.webp", name: "background.webp" },
      home: { opacity: 0.7, blurPx: 1 },
      workspace: { opacity: 0.24, blurPx: 6 },
      immersiveMode: true,
      transparentRegions: {
        "desktop-titlebar": true,
        canvas: true,
        navigation: false,
        "primary-sidebar": true,
        content: false,
        "secondary-sidebar": true,
        chrome: false,
      },
    },
  });

  assert.equal(preferences.version, 9);
  assert.equal(preferences.appearance.immersiveMode, true);
  assert.deepEqual(preferences.appearance.customBackgrounds["silent-gallery"], {
    path: "E:/background.webp",
    name: "background.webp",
  });
  assert.equal(preferences.appearance.transparentRegions["desktop-titlebar"], true);
  assert.equal(preferences.appearance.transparentRegions["home-topbar"], false);
  assert.equal(preferences.appearance.transparentRegions["primary-sidebar"], true);
  assert.deepEqual(preferences.appearance.home, { opacity: 0.7, blurPx: 1 });
});

test("version seven preferences preserve home chrome and gain home content transparency", () => {
  const preferences = normalizePreferences({
    version: 7,
    themeId: "sea-fog",
    appearance: {
      customBackground: null,
      home: { opacity: 0.82, blurPx: 3 },
      workspace: { opacity: 0.36, blurPx: 2 },
      immersiveMode: false,
      transparentRegions: {
        "desktop-titlebar": true,
        "home-topbar": true,
        canvas: false,
        navigation: true,
        "primary-sidebar": false,
        content: true,
        "secondary-sidebar": false,
        chrome: true,
      },
    },
  });

  assert.equal(preferences.version, 9);
  assert.equal(preferences.appearance.immersiveMode, false);
  assert.equal(preferences.appearance.transparentRegions["desktop-titlebar"], true);
  assert.equal(preferences.appearance.transparentRegions["home-topbar"], true);
  assert.equal(preferences.appearance.transparentRegions["home-entry"], false);
  assert.equal(preferences.appearance.transparentRegions["home-recents"], false);
  assert.deepEqual(preferences.appearance.home, { opacity: 0.82, blurPx: 3 });
});

test("version eight custom background migrates only to the active theme", () => {
  const preferences = normalizePreferences({
    version: 8,
    themeId: "sea-fog",
    appearance: {
      customBackground: { path: "E:/legacy.webp", name: "legacy.webp" },
      home: { opacity: 0.66, blurPx: 2 },
      workspace: { opacity: 0.31, blurPx: 4 },
      immersiveMode: false,
      transparentRegions: createDefaultPreferences().appearance.transparentRegions,
    },
  });

  assert.equal(preferences.version, 9);
  assert.deepEqual(preferences.appearance.customBackgrounds, {
    "sea-fog": { path: "E:/legacy.webp", name: "legacy.webp" },
  });
  assert.equal(resolveAppearance(preferences).customBackground?.name, "legacy.webp");
  assert.equal(
    resolveAppearance({ ...preferences, themeId: "silent-gallery" }).customBackground,
    null,
  );
});

test("version nine keeps independent valid backgrounds for known themes", () => {
  const defaults = createDefaultPreferences("warm-paper");
  const preferences = normalizePreferences({
    ...defaults,
    appearance: {
      ...defaults.appearance,
      customBackgrounds: {
        "warm-paper": { path: "E:/warm.webp", name: "warm.webp" },
        "silent-gallery": { path: "E:/dark.webp", name: "dark.webp" },
        "sea-fog": { path: "", name: "invalid.webp" },
        unknown: { path: "E:/unknown.webp", name: "unknown.webp" },
      },
    },
  });

  assert.deepEqual(preferences.appearance.customBackgrounds, {
    "warm-paper": { path: "E:/warm.webp", name: "warm.webp" },
    "silent-gallery": { path: "E:/dark.webp", name: "dark.webp" },
  });
  assert.equal(resolveAppearance(preferences).customBackground?.name, "warm.webp");
  assert.equal(
    resolveAppearance({ ...preferences, themeId: "silent-gallery" }).customBackground?.name,
    "dark.webp",
  );
  assert.equal(resolveAppearance({ ...preferences, themeId: "sea-fog" }).customBackground, null);
});

test("region transparency accepts only known boolean values", () => {
  const defaults = createDefaultPreferences("warm-paper");
  const preferences = normalizePreferences({
    ...defaults,
    appearance: {
      ...defaults.appearance,
      immersiveMode: "yes",
      transparentRegions: {
        "desktop-titlebar": "yes",
        "home-topbar": "yes",
        "home-entry": "yes",
        "home-recents": true,
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
    "desktop-titlebar": false,
    "home-topbar": false,
    "home-entry": false,
    "home-recents": true,
    canvas: false,
    navigation: true,
    "primary-sidebar": false,
    content: true,
    "secondary-sidebar": true,
    chrome: false,
  });
  assert.equal(preferences.appearance.immersiveMode, false);
});

test("immersive mode makes every application surface transparent without changing saved choices", () => {
  const defaults = createDefaultPreferences("sea-fog");
  const preferences = normalizePreferences({
    ...defaults,
    appearance: {
      ...defaults.appearance,
      immersiveMode: true,
      transparentRegions: {
        ...defaults.appearance.transparentRegions,
        canvas: false,
        navigation: false,
      },
    },
  });
  const resolved = resolveSurfaceTransparency(preferences.appearance);

  assert.equal(preferences.appearance.transparentRegions.canvas, false);
  assert.equal(preferences.appearance.transparentRegions.navigation, false);
  assert.equal(Object.values(resolved).every(Boolean), true);
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
