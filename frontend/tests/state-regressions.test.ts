import assert from "node:assert/strict";
import test from "node:test";

import { providerCredentialCacheToken } from "../src/features/presets/queryKeys.ts";
import { reconcilePersistedContent } from "../src/pages/workspace/components/annotationEditorState.ts";
import {
  createDefaultPreferences,
  normalizePreferences,
  resolveAppearance,
} from "../src/shared/theme/appearance.ts";
import { DEFAULT_THEME_ID } from "../src/shared/theme/themes.ts";

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

test("version one appearance preferences migrate without losing the selected theme", () => {
  const preferences = normalizePreferences({ version: 1, themeId: "sea-fog" });

  assert.equal(preferences.version, 2);
  assert.equal(preferences.themeId, "sea-fog");
  assert.equal(preferences.appearance.customBackground, null);
  assert.deepEqual(preferences.appearance.home, { opacity: null, blurPx: null });
});

test("fresh appearance preferences use the warm paper theme", () => {
  const preferences = createDefaultPreferences();
  const resolved = resolveAppearance(preferences);

  assert.equal(DEFAULT_THEME_ID, "warm-paper");
  assert.equal(preferences.themeId, "warm-paper");
  assert.equal(resolved.theme.id, "warm-paper");
  assert.equal(resolved.home.opacity, 0.82);
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

  assert.equal(resolvedDefaults.workspace.opacity, 0.065);
  assert.equal(resolvedDefaults.workspace.blurPx, 0);
  assert.deepEqual(resolvedCustomized.workspace, { opacity: 0.42, blurPx: 9 });
});
