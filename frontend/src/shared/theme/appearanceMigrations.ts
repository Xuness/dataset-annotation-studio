import { DEFAULT_THEME_ID, isThemeId, type ThemeId } from "./themes.ts";
import {
  APP_SURFACE_REGIONS,
  HOME_CONTENT_LIMITS,
  PREFERENCES_VERSION,
  SCENE_LIMITS,
  createDefaultHomeContent,
  createDefaultPreferences,
  createDefaultSurfaceTransparency,
  createEmptySceneOverrides,
  createEmptyThemeSceneOverrides,
  type AppPreferences,
  type AppSurfaceTransparency,
  type AppearancePreferences,
  type CustomBackground,
  type HomeContentPreferences,
  type SceneOverrides,
  type ThemeCustomBackgrounds,
  type ThemeSceneOverrides,
  type ThemeSceneOverridesByTheme,
} from "./appearanceModel.ts";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeNumber(value: unknown, min: number, max: number): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.min(max, Math.max(min, value));
}

function normalizeSceneOverrides(value: unknown): SceneOverrides {
  if (!isRecord(value)) return createEmptySceneOverrides();
  return {
    opacity: normalizeNumber(value.opacity, SCENE_LIMITS.opacity.min, SCENE_LIMITS.opacity.max),
    blurPx: normalizeNumber(value.blurPx, SCENE_LIMITS.blurPx.min, SCENE_LIMITS.blurPx.max),
  };
}

function hasSceneOverrides(value: ThemeSceneOverrides): boolean {
  return [value.home, value.workspace].some(
    (target) => target.opacity !== null || target.blurPx !== null,
  );
}

function normalizeThemeScene(value: unknown): ThemeSceneOverrides {
  if (!isRecord(value)) return createEmptyThemeSceneOverrides();
  return {
    home: normalizeSceneOverrides(value.home),
    workspace: normalizeSceneOverrides(value.workspace),
  };
}

function normalizeThemeSceneOverrides(value: unknown): ThemeSceneOverridesByTheme {
  if (!isRecord(value)) return {};

  const scenes: ThemeSceneOverridesByTheme = {};
  for (const [themeId, candidate] of Object.entries(value)) {
    if (!isThemeId(themeId)) continue;
    const scene = normalizeThemeScene(candidate);
    if (hasSceneOverrides(scene)) scenes[themeId] = scene;
  }
  return scenes;
}

function migrateLegacySceneOverrides(
  value: Record<string, unknown>,
  themeId: ThemeId,
): ThemeSceneOverridesByTheme {
  const scene = normalizeThemeScene(value);
  return hasSceneOverrides(scene) ? { [themeId]: scene } : {};
}

function normalizeCustomBackground(value: unknown): CustomBackground | null {
  if (!isRecord(value) || typeof value.path !== "string" || typeof value.name !== "string") {
    return null;
  }

  const path = value.path.trim();
  const name = value.name.trim();
  return path && name ? { path, name } : null;
}

function normalizeThemeCustomBackgrounds(value: unknown): ThemeCustomBackgrounds {
  if (!isRecord(value)) return {};

  const backgrounds: ThemeCustomBackgrounds = {};
  for (const [themeId, candidate] of Object.entries(value)) {
    if (!isThemeId(themeId)) continue;
    const background = normalizeCustomBackground(candidate);
    if (background) backgrounds[themeId] = background;
  }
  return backgrounds;
}

function migrateLegacyCustomBackground(value: unknown, themeId: ThemeId): ThemeCustomBackgrounds {
  const background = normalizeCustomBackground(value);
  return background ? { [themeId]: background } : {};
}

function normalizeSurfaceTransparency(value: unknown): AppSurfaceTransparency {
  const defaults = createDefaultSurfaceTransparency();
  if (!isRecord(value)) return defaults;

  return Object.fromEntries(
    APP_SURFACE_REGIONS.map((region) => [
      region,
      typeof value[region] === "boolean" ? value[region] : defaults[region],
    ]),
  ) as AppSurfaceTransparency;
}

function normalizeInlineText(
  value: unknown,
  fallback: string,
  maxLength: number,
  allowEmpty = false,
): string {
  if (typeof value !== "string") return fallback;
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized) return normalized.slice(0, maxLength);
  return allowEmpty ? "" : fallback;
}

function normalizeHomeContent(value: unknown): HomeContentPreferences {
  const defaults = createDefaultHomeContent();
  if (!isRecord(value)) return defaults;

  return {
    headline: normalizeInlineText(
      value.headline,
      defaults.headline,
      HOME_CONTENT_LIMITS.headline,
      true,
    ),
    description: normalizeInlineText(
      value.description,
      defaults.description,
      HOME_CONTENT_LIMITS.description,
      true,
    ),
  };
}

function normalizeAppearancePreferences(
  value: Record<string, unknown>,
  options: {
    themeId: ThemeId;
    preserveRegions: boolean;
    preserveImmersiveMode: boolean;
    preserveThemeBackgrounds: boolean;
    preserveThemeSceneOverrides: boolean;
  },
): AppearancePreferences {
  return {
    customBackgrounds: options.preserveThemeBackgrounds
      ? normalizeThemeCustomBackgrounds(value.customBackgrounds)
      : migrateLegacyCustomBackground(value.customBackground, options.themeId),
    sceneOverrides: options.preserveThemeSceneOverrides
      ? normalizeThemeSceneOverrides(value.sceneOverrides)
      : migrateLegacySceneOverrides(value, options.themeId),
    transparentRegions: options.preserveRegions
      ? normalizeSurfaceTransparency(value.transparentRegions)
      : createDefaultSurfaceTransparency(),
    immersiveMode: options.preserveImmersiveMode && value.immersiveMode === true,
  };
}

export function normalizePreferences(value: unknown): AppPreferences {
  if (!isRecord(value)) return createDefaultPreferences();

  const themeId = isThemeId(value.themeId) ? value.themeId : DEFAULT_THEME_ID;

  // Version 1 stored only the selected theme. Preserve it while adding the
  // current appearance layer instead of resetting the user's existing choice.
  if (value.version === 1) return createDefaultPreferences(themeId);

  // Version 2 already had scene controls. Preserve those values and add the
  // new region-material defaults, with the image canvas transparent by default.
  if (value.version === 2 && isRecord(value.appearance)) {
    return {
      version: PREFERENCES_VERSION,
      themeId,
      appearance: normalizeAppearancePreferences(value.appearance, {
        themeId,
        preserveRegions: false,
        preserveImmersiveMode: false,
        preserveThemeBackgrounds: false,
        preserveThemeSceneOverrides: false,
      }),
      homeContent: createDefaultHomeContent(),
    };
  }

  // Version 3 introduced per-region transparency. A short-lived development
  // build also wrote version 4 while prototyping the retired rain animation.
  // Preserve the useful appearance settings from both formats while adding
  // immersive mode in its disabled state. Normalization also adds the desktop
  // titlebar as an opaque region for backward compatibility.
  if ((value.version === 3 || value.version === 4) && isRecord(value.appearance)) {
    return {
      version: PREFERENCES_VERSION,
      themeId,
      appearance: normalizeAppearancePreferences(value.appearance, {
        themeId,
        preserveRegions: true,
        preserveImmersiveMode: false,
        preserveThemeBackgrounds: false,
        preserveThemeSceneOverrides: false,
      }),
      homeContent: createDefaultHomeContent(),
    };
  }

  // Versions 5 through 8 added immersive mode and optional surface keys. Their
  // single custom background belongs to whichever theme was active at upgrade
  // time, preserving the visible scene without leaking it into other themes.
  const storedVersion = value.version;
  if (
    typeof storedVersion === "number" &&
    Number.isInteger(storedVersion) &&
    storedVersion >= 5 &&
    storedVersion <= 8 &&
    isRecord(value.appearance)
  ) {
    return {
      version: PREFERENCES_VERSION,
      themeId,
      appearance: normalizeAppearancePreferences(value.appearance, {
        themeId,
        preserveRegions: true,
        preserveImmersiveMode: true,
        preserveThemeBackgrounds: false,
        preserveThemeSceneOverrides: false,
      }),
      homeContent: createDefaultHomeContent(),
    };
  }

  // Version 9 introduced independent backgrounds for each theme. Keep those
  // assignments while adding editable homepage copy with its original text.
  if (storedVersion === 9 && isRecord(value.appearance)) {
    return {
      version: PREFERENCES_VERSION,
      themeId,
      appearance: normalizeAppearancePreferences(value.appearance, {
        themeId,
        preserveRegions: true,
        preserveImmersiveMode: true,
        preserveThemeBackgrounds: true,
        preserveThemeSceneOverrides: false,
      }),
      homeContent: createDefaultHomeContent(),
    };
  }

  // Version 10 added editable homepage copy. Its scene sliders were still
  // global, so assign those values only to the theme active during upgrade.
  if (storedVersion === 10 && isRecord(value.appearance)) {
    return {
      version: PREFERENCES_VERSION,
      themeId,
      appearance: normalizeAppearancePreferences(value.appearance, {
        themeId,
        preserveRegions: true,
        preserveImmersiveMode: true,
        preserveThemeBackgrounds: true,
        preserveThemeSceneOverrides: false,
      }),
      homeContent: normalizeHomeContent(value.homeContent),
    };
  }

  if (storedVersion === PREFERENCES_VERSION && isRecord(value.appearance)) {
    return {
      version: PREFERENCES_VERSION,
      themeId,
      appearance: normalizeAppearancePreferences(value.appearance, {
        themeId,
        preserveRegions: true,
        preserveImmersiveMode: true,
        preserveThemeBackgrounds: true,
        preserveThemeSceneOverrides: true,
      }),
      homeContent: normalizeHomeContent(value.homeContent),
    };
  }

  return createDefaultPreferences();
}
