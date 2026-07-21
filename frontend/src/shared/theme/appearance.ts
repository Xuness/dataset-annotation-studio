import { DEFAULT_THEME_ID, getThemeDefinition, isThemeId, type ThemeId } from "./themes.ts";

export const PREFERENCES_VERSION = 6 as const;

export const SCENE_LIMITS = {
  opacity: { min: 0, max: 1 },
  blurPx: { min: 0, max: 32 },
} as const;

export type SceneTarget = "home" | "workspace";

export const APP_SURFACE_REGIONS = [
  "desktop-titlebar",
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

export interface SceneOverrides {
  opacity: number | null;
  blurPx: number | null;
}

export interface AppearancePreferences {
  customBackground: CustomBackground | null;
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
      customBackground: null,
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
      appearance: {
        customBackground: normalizeCustomBackground(value.appearance.customBackground),
        home: normalizeSceneOverrides(value.appearance.home),
        workspace: normalizeSceneOverrides(value.appearance.workspace),
        transparentRegions: createDefaultSurfaceTransparency(),
        immersiveMode: false,
      },
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
      appearance: {
        customBackground: normalizeCustomBackground(value.appearance.customBackground),
        home: normalizeSceneOverrides(value.appearance.home),
        workspace: normalizeSceneOverrides(value.appearance.workspace),
        transparentRegions: normalizeSurfaceTransparency(value.appearance.transparentRegions),
        immersiveMode: false,
      },
    };
  }

  // Version 5 introduced immersive mode. Preserve its state while adding the
  // independently configurable desktop titlebar region.
  if (value.version === 5 && isRecord(value.appearance)) {
    return {
      version: PREFERENCES_VERSION,
      themeId,
      appearance: {
        customBackground: normalizeCustomBackground(value.appearance.customBackground),
        home: normalizeSceneOverrides(value.appearance.home),
        workspace: normalizeSceneOverrides(value.appearance.workspace),
        transparentRegions: normalizeSurfaceTransparency(value.appearance.transparentRegions),
        immersiveMode: value.appearance.immersiveMode === true,
      },
    };
  }

  if (value.version !== PREFERENCES_VERSION || !isRecord(value.appearance)) {
    return createDefaultPreferences();
  }

  return {
    version: PREFERENCES_VERSION,
    themeId,
    appearance: {
      customBackground: normalizeCustomBackground(value.appearance.customBackground),
      home: normalizeSceneOverrides(value.appearance.home),
      workspace: normalizeSceneOverrides(value.appearance.workspace),
      transparentRegions: normalizeSurfaceTransparency(value.appearance.transparentRegions),
      immersiveMode: value.appearance.immersiveMode === true,
    },
  };
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
    customBackground: preferences.appearance.customBackground,
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
