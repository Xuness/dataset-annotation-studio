import { DEFAULT_THEME_ID, getThemeDefinition, isThemeId, type ThemeId } from "./themes.ts";

export const PREFERENCES_VERSION = 9 as const;

export const SCENE_LIMITS = {
  opacity: { min: 0, max: 1 },
  blurPx: { min: 0, max: 32 },
} as const;

export type SceneTarget = "home" | "workspace";

export const APP_SURFACE_REGIONS = [
  "desktop-titlebar",
  "home-topbar",
  "home-entry",
  "home-recents",
  "canvas",
  "navigation",
  "primary-sidebar",
  "content",
  "secondary-sidebar",
  "chrome",
] as const;

export type AppSurfaceRegion = (typeof APP_SURFACE_REGIONS)[number];
export type AppSurfaceTransparency = Record<AppSurfaceRegion, boolean>;

export interface CustomBackground {
  path: string;
  name: string;
}

export type ThemeCustomBackgrounds = Partial<Record<ThemeId, CustomBackground>>;

export interface SceneOverrides {
  opacity: number | null;
  blurPx: number | null;
}

export interface AppearancePreferences {
  customBackgrounds: ThemeCustomBackgrounds;
  home: SceneOverrides;
  workspace: SceneOverrides;
  transparentRegions: AppSurfaceTransparency;
  immersiveMode: boolean;
}

export interface AppPreferences {
  version: typeof PREFERENCES_VERSION;
  themeId: ThemeId;
  appearance: AppearancePreferences;
}

export interface ResolvedSceneAppearance {
  opacity: number;
  blurPx: number;
}

export interface ResolvedAppearance {
  theme: ReturnType<typeof getThemeDefinition>;
  customBackground: CustomBackground | null;
  home: ResolvedSceneAppearance;
  workspace: ResolvedSceneAppearance;
}

function emptySceneOverrides(): SceneOverrides {
  return { opacity: null, blurPx: null };
}

export function createDefaultSurfaceTransparency(): AppSurfaceTransparency {
  return {
    "desktop-titlebar": false,
    "home-topbar": false,
    "home-entry": false,
    "home-recents": false,
    canvas: true,
    navigation: false,
    "primary-sidebar": false,
    content: false,
    "secondary-sidebar": false,
    chrome: false,
  };
}

export function createUniformSurfaceTransparency(transparent: boolean): AppSurfaceTransparency {
  return Object.fromEntries(
    APP_SURFACE_REGIONS.map((region) => [region, transparent]),
  ) as AppSurfaceTransparency;
}

export function createDefaultPreferences(themeId: ThemeId = DEFAULT_THEME_ID): AppPreferences {
  return {
    version: PREFERENCES_VERSION,
    themeId,
    appearance: {
      customBackgrounds: {},
      home: emptySceneOverrides(),
      workspace: emptySceneOverrides(),
      transparentRegions: createDefaultSurfaceTransparency(),
      immersiveMode: false,
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeNumber(value: unknown, min: number, max: number): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.min(max, Math.max(min, value));
}

function normalizeSceneOverrides(value: unknown): SceneOverrides {
  if (!isRecord(value)) return emptySceneOverrides();
  return {
    opacity: normalizeNumber(value.opacity, SCENE_LIMITS.opacity.min, SCENE_LIMITS.opacity.max),
    blurPx: normalizeNumber(value.blurPx, SCENE_LIMITS.blurPx.min, SCENE_LIMITS.blurPx.max),
  };
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

function normalizeAppearancePreferences(
  value: Record<string, unknown>,
  options: {
    themeId: ThemeId;
    preserveRegions: boolean;
    preserveImmersiveMode: boolean;
    preserveThemeBackgrounds: boolean;
  },
): AppearancePreferences {
  return {
    customBackgrounds: options.preserveThemeBackgrounds
      ? normalizeThemeCustomBackgrounds(value.customBackgrounds)
      : migrateLegacyCustomBackground(value.customBackground, options.themeId),
    home: normalizeSceneOverrides(value.home),
    workspace: normalizeSceneOverrides(value.workspace),
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
      }),
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
      }),
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
      }),
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
      }),
    };
  }

  return createDefaultPreferences();
}

export function resolveSurfaceTransparency(
  appearance: AppearancePreferences,
): AppSurfaceTransparency {
  return appearance.immersiveMode
    ? createUniformSurfaceTransparency(true)
    : appearance.transparentRegions;
}

export function resolveAppearance(preferences: AppPreferences): ResolvedAppearance {
  const theme = getThemeDefinition(preferences.themeId);
  return {
    theme,
    customBackground: preferences.appearance.customBackgrounds[theme.id] ?? null,
    home: {
      opacity: preferences.appearance.home.opacity ?? theme.scene.home.opacity,
      blurPx: preferences.appearance.home.blurPx ?? theme.scene.home.blurPx,
    },
    workspace: {
      opacity: preferences.appearance.workspace.opacity ?? theme.scene.workspace.opacity,
      blurPx: preferences.appearance.workspace.blurPx ?? theme.scene.workspace.blurPx,
    },
  };
}
