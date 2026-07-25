import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

import {
  DESKTOP_EXIT_REQUESTED_EVENT,
  EXIT_APPLICATION_COMMAND,
  runDesktopExit,
  type ActiveDesktopJobs,
  type DesktopExitDependencies,
} from "../src/app/desktopExit.ts";
import { providerCredentialCacheToken } from "../src/features/presets/queryKeys.ts";
import {
  hasExistingAnnotationDocument,
  reconcilePersistedContent,
} from "../src/pages/workspace/components/annotationEditorState.ts";
import {
  annotationTagsEqual,
  appendManualTags,
  appendVocabularyTag,
  groupTags,
  parseTagDraft,
  reconcilePersistedTags,
  removeTag,
} from "../src/pages/workspace/components/tagEditorState.ts";
import {
  createDesktopFullscreenToggle,
  isFullscreenShortcut,
} from "../src/shared/desktop/useDesktopWindowBehavior.ts";
import {
  detectRuntimePlatform,
  filterTransparentRegionsForWindowDecorations,
  normalizeLinuxGraphicsMode,
  normalizeRuntimePlatform,
  usesNativeDesktopWindowDecorations,
  usesNativeWindowDecorations,
} from "../src/shared/desktop/runtimePlatform.ts";
import { DEFAULT_INTERFACE_SCALE } from "../src/shared/desktop/useInterfaceScale.ts";
import { DEFAULT_WORKSPACE_LAYOUT } from "../src/pages/workspace/hooks/useWorkspaceLayout.ts";
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
import {
  DEFAULT_THEME_ID,
  getThemeDefinition,
  THEMES,
  type ThemeId,
} from "../src/shared/theme/themes.ts";

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

test("existing annotation tab is exposed only when the current asset has imported content", () => {
  assert.equal(hasExistingAnnotationDocument(undefined), false);
  assert.equal(
    hasExistingAnnotationDocument([
      { channel: "description", exists: true },
      { channel: "existing_annotation", exists: false },
    ]),
    false,
  );
  assert.equal(
    hasExistingAnnotationDocument([
      { channel: "description", exists: false },
      { channel: "existing_annotation", exists: true },
    ]),
    true,
  );
});

test("tag paste parser preserves delimiters, quotes, and newlines", () => {
  assert.deepEqual(parseTagDraft('"artist, name", "quoted ""tag""", two\nlines'), [
    "artist, name",
    'quoted "tag"',
    "two",
    "lines",
  ]);
});

test("structured tag edits preserve existing metadata and classify vocabulary additions", () => {
  const tags = [
    {
      name: "blue_hair",
      category: "general",
      confidence: 0.97,
      origin: "tagger",
    },
  ];

  const manual = appendManualTags(tags, "new_tag");
  const vocabulary = appendVocabularyTag(manual.tags, {
    name: "alice",
    category: "character",
  });

  assert.deepEqual(vocabulary.tags, [
    tags[0],
    {
      name: "new_tag",
      category: null,
      confidence: null,
      origin: "manual",
    },
    {
      name: "alice",
      category: "character",
      confidence: null,
      origin: "manual",
    },
  ]);
});

test("structured tag additions de-duplicate case-insensitively", () => {
  const previous = [
    {
      name: "Blue_Hair",
      category: "general",
      confidence: 0.91,
      origin: "tagger",
    },
  ];

  const result = appendManualTags(previous, "blue_hair, BLUE_HAIR, new_tag");

  assert.equal(result.duplicateKey, "blue_hair");
  assert.equal(result.addedCount, 1);
  assert.deepEqual(result.tags, [
    previous[0],
    {
      name: "new_tag",
      category: null,
      confidence: null,
      origin: "manual",
    },
  ]);
});

test("tag groups use stable semantic order without changing stored order", () => {
  const tags = [
    {
      name: "solo",
      category: null,
      confidence: null,
      origin: "manual",
    },
    {
      name: "blue_hair",
      category: "general",
      confidence: 0.97,
      origin: "tagger",
    },
    {
      name: "alice",
      category: "character",
      confidence: 0.93,
      origin: "tagger",
    },
    {
      name: "series",
      category: "copyright",
      confidence: 0.88,
      origin: "tagger",
    },
  ];

  assert.deepEqual(
    groupTags(tags).map((group) => group.category),
    ["character", "copyright", "general", null],
  );
  assert.deepEqual(
    tags.map((tag) => tag.name),
    ["solo", "blue_hair", "alice", "series"],
  );
});

test("tag save reconciliation preserves edits made while the request is pending", () => {
  const submitted = [
    {
      name: "artist_name",
      category: "artist",
      confidence: 0.97,
      origin: "tagger",
    },
  ];
  const current = [
    ...submitted,
    {
      name: "new_tag",
      category: null,
      confidence: null,
      origin: "manual",
    },
  ];

  assert.deepEqual(reconcilePersistedTags(current, submitted, submitted), current);
  assert.equal(annotationTagsEqual(removeTag(current, "new_tag"), submitted), true);
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

test("runtime platform detection keeps native decorations and scene ownership on Linux", () => {
  assert.equal(
    detectRuntimePlatform("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/605.1.15", "Linux x86_64"),
    "linux",
  );
  assert.equal(detectRuntimePlatform("Mozilla/5.0 (Windows NT 10.0; Win64; x64)"), "windows");
  assert.equal(usesNativeWindowDecorations("linux"), true);
  assert.equal(usesNativeWindowDecorations("windows"), false);
  assert.equal(usesNativeDesktopWindowDecorations(true, "linux"), true);
  assert.equal(usesNativeDesktopWindowDecorations(false, "linux"), false);
  assert.deepEqual(
    filterTransparentRegionsForWindowDecorations(
      ["desktop-titlebar", "home-topbar", "content"],
      true,
    ),
    ["home-topbar", "content"],
  );
  assert.deepEqual(
    filterTransparentRegionsForWindowDecorations(["desktop-titlebar", "content"], false),
    ["desktop-titlebar", "content"],
  );
  assert.equal(normalizeLinuxGraphicsMode("software"), "software");
  assert.equal(normalizeLinuxGraphicsMode("dmabuf-off"), "dmabuf-off");
  assert.equal(normalizeLinuxGraphicsMode("unexpected"), "default");
  assert.equal(normalizeLinuxGraphicsMode(undefined), "default");
  assert.equal(normalizeRuntimePlatform("linux", "windows"), "linux");
  assert.equal(normalizeRuntimePlatform("unexpected", "windows"), "windows");
});

test("Linux visual degradation is scoped to the explicit software mode", () => {
  const linuxCompatibility = readFileSync(
    new URL("../src/styles/platforms/linux-compat.css", import.meta.url),
    "utf8",
  );
  const reducedCompositionDeclaration =
    /backdrop-filter:\s*none\s*!important|filter:\s*none\s*!important|animation:\s*none\s*!important|background:\s*color-mix/g;
  const blocks = linuxCompatibility.matchAll(/([^{}]+)\{([^{}]*)\}/g);
  let reducedBlockCount = 0;

  for (const [, selector, declarations] of blocks) {
    if (!reducedCompositionDeclaration.test(declarations)) continue;
    reducedCompositionDeclaration.lastIndex = 0;
    reducedBlockCount += 1;
    assert.match(selector, /data-linux-graphics-mode="software"/);
  }

  assert.ok(reducedBlockCount >= 8);
  const defaultShellRule = linuxCompatibility.match(
    /:root\[data-runtime-platform="linux"\]\s+\.desktop-shell--tauri\s*\{([^}]*)\}/,
  );
  assert.ok(defaultShellRule);
  assert.doesNotMatch(defaultShellRule[1], /transition:\s*none/);
});

test("large page scenes use paint containment without changing shared animation timing", () => {
  const homeStyles = readFileSync(new URL("../src/pages/home/home.css", import.meta.url), "utf8");
  const workspaceStyles = readFileSync(
    new URL("../src/layouts/workspace/workspace-shell.css", import.meta.url),
    "utf8",
  );
  const workspaceMaterialStyles = readFileSync(
    new URL("../src/layouts/workspace/workspace-surface-materials.css", import.meta.url),
    "utf8",
  );

  assert.match(homeStyles, /\.home-gallery-scene\s*\{[^}]*contain:\s*paint/s);
  assert.match(workspaceStyles, /\.workspace-atmosphere\s*\{[^}]*contain:\s*paint/s);
  assert.match(homeStyles, /\.home-page\s*\{[^}]*animation:\s*home-reveal\s+700ms/s);
  assert.match(homeStyles, /backdrop-filter\s+220ms\s+ease/);
  assert.match(workspaceMaterialStyles, /backdrop-filter\s+var\(--transition\)/);
});

test("tag editor follows the content region transparency setting", () => {
  const workspaceContentMaterialStyles = readFileSync(
    new URL("../src/pages/workspace/styles/surface-materials.css", import.meta.url),
    "utf8",
  );
  const transparentContentRule = workspaceContentMaterialStyles
    .match(/[^{}]+\{\s*background:\s*transparent;\s*\}/g)
    ?.find((rule) => rule.includes(".annotation-editor__header"));

  assert.ok(transparentContentRule);
  assert.match(transparentContentRule, /\.tag-editor,/);
  assert.match(transparentContentRule, /\.tag-editor__toolbar/);
  assert.match(transparentContentRule, /\.translation-compare__aligned/);
  assert.match(transparentContentRule, /\.translation-compare__plain/);
  assert.match(transparentContentRule, /\.translation-compare__unaligned/);
  assert.match(transparentContentRule, /\.translation-compare__mismatch/);
});

test("rainveil immersive wallpaper uses only a higher-contrast copyright label color", () => {
  const themeStyles = readFileSync(
    new URL("../src/styles/themes/sea-fog.css", import.meta.url),
    "utf8",
  );
  const tagEditorStyles = readFileSync(
    new URL("../src/pages/workspace/styles/tag-editor.css", import.meta.url),
    "utf8",
  );

  assert.match(
    themeStyles,
    /data-theme="sea-fog".*data-immersive-mode="true".*data-background-source="theme"/,
  );
  assert.match(themeStyles, /--tag-copyright-tone:\s*#30483f/);
  assert.match(tagEditorStyles, /var\(--tag-copyright-tone,\s*var\(--sage\)\)/);
  assert.doesNotMatch(themeStyles, /--tag-copyright-label-background/);
  assert.doesNotMatch(tagEditorStyles, /tag-copyright-label-background/);
});

test("fresh interface geometry uses the curated local baseline", () => {
  assert.equal(DEFAULT_INTERFACE_SCALE, 1.2);
  assert.deepEqual(DEFAULT_WORKSPACE_LAYOUT, {
    assetPaneWidth: 278,
    inspectorPaneWidth: 310,
    imagePaneRatio: 66,
  });
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
  const folderBridge = readFileSync(
    new URL("../src/shared/desktop/openLocalFolder.ts", import.meta.url),
    "utf8",
  );
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
    ["$LOCALDATA/DatasetAnnotationStudio/**"],
  );
  assert.equal(capability.permissions.includes("core:window:allow-maximize"), true);
  assert.equal(capability.permissions.includes("core:window:allow-unmaximize"), true);
  assert.equal(capability.permissions.includes("core:window:allow-destroy"), false);
  assert.match(folderBridge, /invoke\(OPEN_DIRECTORY_COMMAND,\s*\{\s*path\s*\}\)/);
  assert.doesNotMatch(folderBridge, /\bopenPath\(/);
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
  assert.equal(preferences.appearance.transparentRegions.canvas, false);
  assert.equal(preferences.appearance.immersiveMode, true);
  assert.deepEqual(preferences.homeContent, DEFAULT_HOME_CONTENT);
});

test("fresh appearance preferences use the rainveil gothic theme", () => {
  const preferences = createDefaultPreferences();
  const resolved = resolveAppearance(preferences);

  assert.equal(DEFAULT_THEME_ID, "sea-fog");
  assert.equal(preferences.themeId, "sea-fog");
  assert.equal(resolved.theme.id, "sea-fog");
  assert.deepEqual(resolved.home, { opacity: 0.85, blurPx: 10 });
  assert.deepEqual(resolved.workspace, { opacity: 0.65, blurPx: 4 });
  assert.equal(preferences.appearance.immersiveMode, true);
  assert.equal(preferences.appearance.transparentRegions["desktop-titlebar"], true);
  assert.equal(preferences.appearance.transparentRegions.canvas, false);
  assert.deepEqual(preferences.homeContent, {
    headline: "好久不见......",
    description: "今天想做什么？",
  });
});

test("theme styles keep a complete shared token contract and the configured default baseline", () => {
  const styleFiles: Record<ThemeId, string> = {
    "warm-paper": "warm-paper.css",
    "silent-gallery": "silent-gallery.css",
    "sea-fog": "sea-fog.css",
  };
  const styles = Object.fromEntries(
    Object.entries(styleFiles).map(([themeId, filename]) => [
      themeId,
      readFileSync(new URL(`../src/styles/themes/${filename}`, import.meta.url), "utf8"),
    ]),
  ) as Record<ThemeId, string>;
  const tokenNames = (css: string) =>
    new Set([...css.matchAll(/^\s*(--[\w-]+)\s*:/gm)].map((match) => match[1]));
  const sharedTokens = tokenNames(styles["silent-gallery"]);

  for (const [themeId, css] of Object.entries(styles) as Array<[ThemeId, string]>) {
    const missing = [...sharedTokens].filter((token) => !tokenNames(css).has(token));
    assert.deepEqual(missing, [], `${themeId} is missing shared theme tokens`);
  }

  assert.match(
    styles[DEFAULT_THEME_ID],
    new RegExp(`^:root,\\s*\\n:root\\[data-theme="${DEFAULT_THEME_ID}"\\]`, "m"),
  );
  for (const theme of THEMES.filter((candidate) => candidate.id !== DEFAULT_THEME_ID)) {
    assert.doesNotMatch(styles[theme.id], /^:root,/m);
  }

  const documentHtml = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  assert.match(
    documentHtml,
    new RegExp(
      `<meta name="theme-color" content="${getThemeDefinition(DEFAULT_THEME_ID).browserThemeColor}"`,
    ),
  );
});

test("theme defaults bundle the selected wallpapers and current scene clarity", () => {
  const expected = {
    "warm-paper": {
      image: "/home/暖纸手札-默认壁纸-含彩蛋.png",
      home: { opacity: 0.65, blurPx: 6 },
      workspace: { opacity: 0.55, blurPx: 4 },
    },
    "silent-gallery": {
      image: "/home/静默展厅-默认壁纸-含彩蛋.png",
      home: { opacity: 0.85, blurPx: 6 },
      workspace: { opacity: 0.85, blurPx: 6 },
    },
    "sea-fog": {
      image: "/home/雨白哥特-默认壁纸-含彩蛋.png",
      home: { opacity: 0.85, blurPx: 10 },
      workspace: { opacity: 0.65, blurPx: 4 },
    },
  } as const;

  for (const theme of THEMES) {
    const themeDefaults = expected[theme.id];
    const publicFile = new URL(`../public${themeDefaults.image}`, import.meta.url);

    assert.equal(theme.scene.image, themeDefaults.image);
    assert.equal(theme.scene.home.position, "center");
    assert.equal(theme.scene.home.size, "contain");
    assert.equal(theme.scene.workspace.position, "center");
    assert.equal(theme.scene.workspace.size, "cover");
    assert.deepEqual(
      resolveAppearance(createDefaultPreferences(theme.id)).home,
      themeDefaults.home,
    );
    assert.deepEqual(
      resolveAppearance(createDefaultPreferences(theme.id)).workspace,
      themeDefaults.workspace,
    );
    assert.equal(existsSync(publicFile), true, `${theme.name} default wallpaper is missing`);
  }
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
  assert.equal(preferences.appearance.transparentRegions.canvas, false);
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
  assert.equal(preferences.appearance.transparentRegions.canvas, false);
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
  assert.equal(preferences.appearance.transparentRegions["desktop-titlebar"], true);
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
  assert.equal(preferences.appearance.transparentRegions["desktop-titlebar"], true);
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
  assert.equal(preferences.appearance.transparentRegions["desktop-titlebar"], true);
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
    opacity: 0.65,
    blurPx: 4,
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
    "desktop-titlebar": true,
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
  assert.equal(resolvedDefaults.theme.scene.image, "/home/雨白哥特-默认壁纸-含彩蛋.png");
  assert.equal(resolvedDefaults.workspace.opacity, 0.65);
  assert.equal(resolvedDefaults.workspace.blurPx, 4);
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

function desktopJobs(overrides: Partial<ActiveDesktopJobs> = {}): ActiveDesktopJobs {
  return {
    annotation_job_count: 0,
    translation_job_count: 0,
    preprocessing_count: 0,
    export_count: 0,
    asset_deletion_count: 0,
    tagger_download_count: 0,
    tag_dictionary_download_count: 0,
    ...overrides,
  };
}

function desktopExitDependencies(
  overrides: Partial<DesktopExitDependencies> = {},
): DesktopExitDependencies {
  return {
    confirm: async () => true,
    message: async () => undefined,
    getActiveJobs: async () => desktopJobs(),
    stopAllWorkspaceJobs: async () => undefined,
    delay: async () => undefined,
    exitApplication: async () => undefined,
    ...overrides,
  };
}

test("desktop exit leaves an unsaved window running when discard is rejected", async () => {
  const calls: string[] = [];
  const result = await runDesktopExit(
    true,
    desktopExitDependencies({
      confirm: async () => {
        calls.push("confirm-discard");
        return false;
      },
      getActiveJobs: async () => {
        calls.push("get-active");
        return desktopJobs();
      },
      exitApplication: async () => {
        calls.push("exit");
      },
    }),
  );

  assert.equal(result, "cancelled");
  assert.deepEqual(calls, ["confirm-discard"]);
});

test("desktop lifecycle bridge names stay aligned with the Rust host", () => {
  const desktopHost = readFileSync(
    new URL("../../src-tauri/src/desktop.rs", import.meta.url),
    "utf8",
  );
  const tauriEntry = readFileSync(new URL("../../src-tauri/src/lib.rs", import.meta.url), "utf8");

  assert.match(
    desktopHost,
    new RegExp(`EXIT_REQUESTED_EVENT: &str = "${DESKTOP_EXIT_REQUESTED_EVENT}"`),
  );
  assert.match(desktopHost, new RegExp(`fn ${EXIT_APPLICATION_COMMAND}\\(`));
  assert.match(tauriEntry, new RegExp(`desktop::${EXIT_APPLICATION_COMMAND}`));
});

test("large application panels do not create nested native dialogs", () => {
  const settingsCenter = readFileSync(
    new URL("../src/app/settings/SettingsCenter.tsx", import.meta.url),
    "utf8",
  );
  const assetDeletion = readFileSync(
    new URL("../src/pages/workspace/components/AssetDeletionDialog.tsx", import.meta.url),
    "utf8",
  );
  const dialogHost = readFileSync(
    new URL("../src/shared/ui/DialogHost.tsx", import.meta.url),
    "utf8",
  );

  assert.doesNotMatch(settingsCenter, /<dialog|showModal\(/);
  assert.doesNotMatch(assetDeletion, /<dialog|showModal\(/);
  assert.match(dialogHost, /<dialog/);
  assert.match(dialogHost, /dialog\.close\(\);\s+settle\(/);
});

test("desktop exit blocks while preprocessing is writing files", async () => {
  const calls: string[] = [];
  const result = await runDesktopExit(
    false,
    desktopExitDependencies({
      getActiveJobs: async () => desktopJobs({ preprocessing_count: 1 }),
      message: async () => {
        calls.push("blocked-message");
      },
      exitApplication: async () => {
        calls.push("exit");
      },
    }),
  );

  assert.equal(result, "blocked");
  assert.deepEqual(calls, ["blocked-message"]);
});

test("desktop exit safely stops resumable jobs before terminating the application", async () => {
  const calls: string[] = [];
  let activeChecks = 0;
  const result = await runDesktopExit(
    false,
    desktopExitDependencies({
      getActiveJobs: async () => {
        activeChecks += 1;
        calls.push(`get-active:${activeChecks}`);
        return activeChecks < 3
          ? desktopJobs({
              annotation_job_count: 1,
              export_count: 1,
              tagger_download_count: 1,
            })
          : desktopJobs();
      },
      confirm: async () => {
        calls.push("confirm-stop");
        return true;
      },
      stopAllWorkspaceJobs: async () => {
        calls.push("stop-all");
      },
      delay: async () => {
        calls.push("delay");
      },
      exitApplication: async () => {
        calls.push("exit");
      },
    }),
  );

  assert.equal(result, "exiting");
  assert.deepEqual(calls, [
    "get-active:1",
    "confirm-stop",
    "stop-all",
    "delay",
    "get-active:2",
    "delay",
    "get-active:3",
    "exit",
  ]);
});

test("desktop exit requires a second confirmation when job state cannot be verified", async () => {
  const calls: string[] = [];
  const result = await runDesktopExit(
    false,
    desktopExitDependencies({
      getActiveJobs: async () => {
        calls.push("get-active");
        throw new Error("service unavailable");
      },
      confirm: async () => {
        calls.push("confirm-force");
        return true;
      },
      exitApplication: async () => {
        calls.push("exit");
      },
    }),
  );

  assert.equal(result, "exiting");
  assert.deepEqual(calls, ["get-active", "confirm-force", "exit"]);
});
