import { DEFAULT_THEME_ID, getThemeDefinition, type ThemeId } from "./themes.ts";

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
