import { DEFAULT_THEME_ID, getThemeDefinition, type ThemeId } from "./themes.ts";

export const PREFERENCES_VERSION = 11 as const;

export const DEFAULT_HOME_CONTENT = {
  headline: "好久不见......",
  description: "今天想做什么？",
} as const;

export const HOME_CONTENT_LIMITS = {
  headline: 48,
  description: 72,
} as const;

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

export interface ThemeSceneOverrides {
  home: SceneOverrides;
  workspace: SceneOverrides;
}

export type ThemeSceneOverridesByTheme = Partial<Record<ThemeId, ThemeSceneOverrides>>;

export interface AppearancePreferences {
  customBackgrounds: ThemeCustomBackgrounds;
  sceneOverrides: ThemeSceneOverridesByTheme;
  transparentRegions: AppSurfaceTransparency;
  immersiveMode: boolean;
}

export interface HomeContentPreferences {
  headline: string;
  description: string;
}

export interface AppPreferences {
  version: typeof PREFERENCES_VERSION;
  themeId: ThemeId;
  appearance: AppearancePreferences;
  homeContent: HomeContentPreferences;
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

export function createEmptySceneOverrides(): SceneOverrides {
  return { opacity: null, blurPx: null };
}

export function createEmptyThemeSceneOverrides(): ThemeSceneOverrides {
  return {
    home: createEmptySceneOverrides(),
    workspace: createEmptySceneOverrides(),
  };
}

export function getThemeSceneOverrides(
  appearance: AppearancePreferences,
  themeId: ThemeId,
): ThemeSceneOverrides {
  return appearance.sceneOverrides[themeId] ?? createEmptyThemeSceneOverrides();
}

export function createDefaultHomeContent(): HomeContentPreferences {
  return { ...DEFAULT_HOME_CONTENT };
}

export function createDefaultSurfaceTransparency(): AppSurfaceTransparency {
  return {
    "desktop-titlebar": true,
    "home-topbar": false,
    "home-entry": false,
    "home-recents": false,
    canvas: false,
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
      sceneOverrides: {},
      transparentRegions: createDefaultSurfaceTransparency(),
      immersiveMode: true,
    },
    homeContent: createDefaultHomeContent(),
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
  const sceneOverrides = getThemeSceneOverrides(preferences.appearance, theme.id);
  return {
    theme,
    customBackground: preferences.appearance.customBackgrounds[theme.id] ?? null,
    home: {
      opacity: sceneOverrides.home.opacity ?? theme.scene.home.opacity,
      blurPx: sceneOverrides.home.blurPx ?? theme.scene.home.blurPx,
    },
    workspace: {
      opacity: sceneOverrides.workspace.opacity ?? theme.scene.workspace.opacity,
      blurPx: sceneOverrides.workspace.blurPx ?? theme.scene.workspace.blurPx,
    },
  };
}
