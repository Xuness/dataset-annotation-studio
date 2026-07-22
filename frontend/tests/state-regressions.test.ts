import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { providerCredentialCacheToken } from "../src/features/presets/queryKeys.ts";
import { reconcilePersistedContent } from "../src/pages/workspace/components/annotationEditorState.ts";
import {
  createDesktopFullscreenToggle,
  isFullscreenShortcut,
} from "../src/shared/desktop/useDesktopWindowBehavior.ts";
import {
  DEFAULT_HOME_CONTENT,
  HOME_CONTENT_LIMITS,
  PREFERENCES_VERSION,
  createDefaultPreferences,
  getThemeSceneOverrides,
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

test("fullscreen toggle restores a maximized Windows window without carrying its work area", async () => {
  let fullscreen = false;
  let maximized = true;
  const calls: string[] = [];
  const toggleFullscreen = createDesktopFullscreenToggle(
    {
      async isFullscreen() {
        calls.push("is-fullscreen");
        return fullscreen;
      },
      async isMaximized() {
        calls.push("is-maximized");
        return maximized;
      },
      async maximize() {
        calls.push("maximize");
        maximized = true;
      },
      async setFullscreen(nextFullscreen) {
        calls.push(`set-fullscreen:${nextFullscreen}`);
        fullscreen = nextFullscreen;
      },
      async unmaximize() {
        calls.push("unmaximize");
        maximized = false;
      },
    },
    true,
  );

  assert.equal(await toggleFullscreen(), true);
  assert.deepEqual(calls, ["is-fullscreen", "is-maximized", "unmaximize", "set-fullscreen:true"]);

  calls.length = 0;
  assert.equal(await toggleFullscreen(), false);
  assert.deepEqual(calls, ["is-fullscreen", "set-fullscreen:false", "maximize"]);
  assert.equal(maximized, true);
});

test("desktop capabilities allow opening verified local folders", () => {
  const capabilityPath = new URL("../../src-tauri/capabilities/default.json", import.meta.url);
  const capability = JSON.parse(readFileSync(capabilityPath, "utf8")) as {
    permissions: Array<
      | string
      | {
          identifier: string;
          allow?: Array<{ path?: string }>;
        }
    >;
  };
  const openPathPermission = capability.permissions.find(
    (permission) =>
      typeof permission !== "string" && permission.identifier === "opener:allow-open-path",
  );

  assert.ok(openPathPermission && typeof openPathPermission !== "string");
  assert.deepEqual(
    openPathPermission.allow?.map((entry) => entry.path),
    ["$LOCALDATA/DatasetAnnotationStudio/**", "$LOCALDATA/Dataset Studio/**"],
  );
  assert.equal(capability.permissions.includes("core:window:allow-maximize"), true);
  assert.equal(capability.permissions.includes("core:window:allow-unmaximize"), true);
});

test("preprocess scope controls use eager route-independent styles", () => {
  const globalStyles = readFileSync(new URL("../src/styles/global.css", import.meta.url), "utf8");
  const formStyles = readFileSync(new URL("../src/styles/forms.css", import.meta.url), "utf8");
  const preprocessStyles = readFileSync(
    new URL("../src/pages/preprocess/preprocess.css", import.meta.url),
    "utf8",
  );
  const preprocessPanel = readFileSync(
    new URL("../src/pages/preprocess/components/PreprocessSettingsPanel.tsx", import.meta.url),
    "utf8",
  );

  assert.match(globalStyles, /@import "\.\/forms\.css";/);
  assert.match(formStyles, /\.scope-selector\s*\{/);
  assert.match(preprocessStyles, /\.preprocess-settings \.scope-selector\s*\{/);
  assert.match(preprocessPanel, /className="scope-selector"/);
  assert.doesNotMatch(preprocessPanel, /job-scope/);
});

test("version one appearance preferences migrate without losing the selected theme", () => {
  const preferences = normalizePreferences({ version: 1, themeId: "sea-fog" });

  assert.equal(preferences.version, PREFERENCES_VERSION);
  assert.equal(preferences.themeId, "sea-fog");
  assert.deepEqual(preferences.appearance.customBackgrounds, {});
  assert.deepEqual(preferences.appearance.sceneOverrides, {});
  assert.equal(preferences.appearance.transparentRegions.canvas, true);
  assert.deepEqual(preferences.homeContent, DEFAULT_HOME_CONTENT);
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
  assert.deepEqual(preferences.appearance.sceneOverrides["silent-gallery"], {
    home: { opacity: 1, blurPx: 0 },
    workspace: { opacity: null, blurPx: 32 },
  });
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

  assert.equal(preferences.version, PREFERENCES_VERSION);
  assert.equal(preferences.themeId, "silent-gallery");
  assert.deepEqual(preferences.appearance.customBackgrounds["silent-gallery"], {
    path: "E:/background.webp",
    name: "background.webp",
  });
  assert.deepEqual(preferences.appearance.sceneOverrides["silent-gallery"]?.workspace, {
    opacity: 0.18,
    blurPx: 5,
  });
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

  assert.equal(preferences.version, PREFERENCES_VERSION);
  assert.equal(preferences.appearance.immersiveMode, false);
  assert.equal(preferences.appearance.transparentRegions["desktop-titlebar"], false);
  assert.equal(preferences.appearance.transparentRegions["home-topbar"], false);
  assert.equal(preferences.appearance.transparentRegions.navigation, true);
  assert.equal(preferences.appearance.transparentRegions.content, true);
  assert.deepEqual(preferences.appearance.sceneOverrides["silent-gallery"]?.workspace, {
    opacity: 0.34,
    blurPx: 2,
  });
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

  assert.equal(preferences.version, PREFERENCES_VERSION);
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
  assert.deepEqual(preferences.appearance.sceneOverrides["sea-fog"]?.workspace, {
    opacity: 0.28,
    blurPx: 4,
  });
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

  assert.equal(preferences.version, PREFERENCES_VERSION);
  assert.equal(preferences.appearance.immersiveMode, true);
  assert.equal(preferences.appearance.transparentRegions["desktop-titlebar"], false);
  assert.equal(preferences.appearance.transparentRegions["home-topbar"], false);
  assert.equal(preferences.appearance.transparentRegions.navigation, true);
  assert.deepEqual(preferences.appearance.sceneOverrides["sea-fog"]?.workspace, {
    opacity: 0.38,
    blurPx: 3,
  });
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

  assert.equal(preferences.version, PREFERENCES_VERSION);
  assert.equal(preferences.appearance.immersiveMode, true);
  assert.deepEqual(preferences.appearance.customBackgrounds["silent-gallery"], {
    path: "E:/background.webp",
    name: "background.webp",
  });
  assert.equal(preferences.appearance.transparentRegions["desktop-titlebar"], true);
  assert.equal(preferences.appearance.transparentRegions["home-topbar"], false);
  assert.equal(preferences.appearance.transparentRegions["primary-sidebar"], true);
  assert.deepEqual(preferences.appearance.sceneOverrides["silent-gallery"]?.home, {
    opacity: 0.7,
    blurPx: 1,
  });
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

  assert.equal(preferences.version, PREFERENCES_VERSION);
  assert.equal(preferences.appearance.immersiveMode, false);
  assert.equal(preferences.appearance.transparentRegions["desktop-titlebar"], true);
  assert.equal(preferences.appearance.transparentRegions["home-topbar"], true);
  assert.equal(preferences.appearance.transparentRegions["home-entry"], false);
  assert.equal(preferences.appearance.transparentRegions["home-recents"], false);
  assert.deepEqual(preferences.appearance.sceneOverrides["sea-fog"]?.home, {
    opacity: 0.82,
    blurPx: 3,
  });
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

  assert.equal(preferences.version, PREFERENCES_VERSION);
  assert.deepEqual(preferences.appearance.customBackgrounds, {
    "sea-fog": { path: "E:/legacy.webp", name: "legacy.webp" },
  });
  assert.equal(resolveAppearance(preferences).customBackground?.name, "legacy.webp");
  assert.equal(
    resolveAppearance({ ...preferences, themeId: "silent-gallery" }).customBackground,
    null,
  );
});

test("version nine keeps independent backgrounds and gains default homepage copy", () => {
  const defaults = createDefaultPreferences("warm-paper");
  const preferences = normalizePreferences({
    version: 9,
    themeId: defaults.themeId,
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
  assert.deepEqual(preferences.homeContent, DEFAULT_HOME_CONTENT);
});

test("version ten scene overrides migrate only to the active theme", () => {
  const defaults = createDefaultPreferences("sea-fog");
  const preferences = normalizePreferences({
    version: 10,
    themeId: "sea-fog",
    appearance: {
      customBackgrounds: {},
      home: { opacity: 0.71, blurPx: 2 },
      workspace: { opacity: 0.37, blurPx: 5 },
      transparentRegions: defaults.appearance.transparentRegions,
      immersiveMode: false,
    },
    homeContent: { headline: "雾中档案", description: "只留给当前主题" },
  });

  assert.deepEqual(preferences.appearance.sceneOverrides, {
    "sea-fog": {
      home: { opacity: 0.71, blurPx: 2 },
      workspace: { opacity: 0.37, blurPx: 5 },
    },
  });
  assert.deepEqual(getThemeSceneOverrides(preferences.appearance, "silent-gallery"), {
    home: { opacity: null, blurPx: null },
    workspace: { opacity: null, blurPx: null },
  });
  assert.deepEqual(preferences.homeContent, {
    headline: "雾中档案",
    description: "只留给当前主题",
  });
});

test("current preferences keep scene overrides independent for each known theme", () => {
  const defaults = createDefaultPreferences("silent-gallery");
  const preferences = normalizePreferences({
    ...defaults,
    appearance: {
      ...defaults.appearance,
      sceneOverrides: {
        "silent-gallery": {
          home: { opacity: 0.47, blurPx: 3 },
          workspace: { opacity: 0.16, blurPx: 5 },
        },
        "warm-paper": {
          home: { opacity: 0.91, blurPx: null },
          workspace: { opacity: -1, blurPx: 80 },
        },
        unknown: {
          home: { opacity: 0.2, blurPx: 2 },
          workspace: { opacity: 0.2, blurPx: 2 },
        },
      },
    },
  });

  assert.deepEqual(preferences.appearance.sceneOverrides, {
    "silent-gallery": {
      home: { opacity: 0.47, blurPx: 3 },
      workspace: { opacity: 0.16, blurPx: 5 },
    },
    "warm-paper": {
      home: { opacity: 0.91, blurPx: null },
      workspace: { opacity: 0, blurPx: 32 },
    },
  });
  assert.deepEqual(resolveAppearance(preferences).home, { opacity: 0.47, blurPx: 3 });
  assert.deepEqual(resolveAppearance({ ...preferences, themeId: "warm-paper" }).workspace, {
    opacity: 0,
    blurPx: 32,
  });
  assert.deepEqual(resolveAppearance({ ...preferences, themeId: "sea-fog" }).workspace, {
    opacity: 0.32,
    blurPx: 0,
  });
});

test("current preferences normalize editable homepage copy", () => {
  const defaults = createDefaultPreferences();
  const preferences = normalizePreferences({
    ...defaults,
    homeContent: {
      headline: `  ${"雾".repeat(HOME_CONTENT_LIMITS.headline + 4)}  `,
      description: "  一座   安静的本地图像档案馆  ",
    },
  });

  assert.equal(preferences.homeContent.headline, "雾".repeat(HOME_CONTENT_LIMITS.headline));
  assert.equal(preferences.homeContent.description, "一座 安静的本地图像档案馆");

  const emptyContent = normalizePreferences({
    ...defaults,
    homeContent: { headline: "   ", description: "   " },
  });
  assert.deepEqual(emptyContent.homeContent, { headline: "", description: "" });

  const invalid = normalizePreferences({
    ...defaults,
    homeContent: { headline: "   ", description: null },
  });
  assert.deepEqual(invalid.homeContent, {
    headline: "",
    description: DEFAULT_HOME_CONTENT.description,
  });
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
      sceneOverrides: {
        "sea-fog": {
          home: { opacity: null, blurPx: null },
          workspace: { opacity: 0.42, blurPx: 9 },
        },
      },
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
      sceneOverrides: {
        "sea-fog": {
          home: { opacity: null, blurPx: null },
          workspace: { opacity: 1, blurPx: null },
        },
      },
    },
  });

  assert.equal(
    resolveAppearance(defaults).theme.material.workspaceSurfaceOpacity,
    resolveAppearance(customized).theme.material.workspaceSurfaceOpacity,
  );
});
