import { DEFAULT_THEME_ID, getThemeDefinition, isThemeId, type ThemeId } from "./themes.ts";

export const PREFERENCES_VERSION = 2 as const;

export const SCENE_LIMITS = {
  opacity: { min: 0, max: 1 },
  blurPx: { min: 0, max: 32 },
} as const;

export type SceneTarget = "home" | "workspace";

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

export function createDefaultPreferences(themeId: ThemeId = DEFAULT_THEME_ID): AppPreferences {
  return {
    version: PREFERENCES_VERSION,
    themeId,
    appearance: {
      customBackground: null,
      home: emptySceneOverrides(),
      workspace: emptySceneOverrides(),
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

export function normalizePreferences(value: unknown): AppPreferences {
  if (!isRecord(value)) return createDefaultPreferences();

  const themeId = isThemeId(value.themeId) ? value.themeId : DEFAULT_THEME_ID;

  // Version 1 stored only the selected theme. Preserve it while adding the new
  // appearance layer instead of resetting the user's existing choice.
  if (value.version === 1) return createDefaultPreferences(themeId);
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
    },
  };
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
