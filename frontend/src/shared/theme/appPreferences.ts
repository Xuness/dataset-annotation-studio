import { create } from "zustand";

import {
  createDefaultSurfaceTransparency,
  createUniformSurfaceTransparency,
  normalizePreferences,
  type AppSurfaceRegion,
  type AppPreferences,
  type CustomBackground,
  type SceneOverrides,
  type SceneTarget,
} from "./appearance";
import { applyPreferences } from "./appearanceRuntime";
import type { ThemeId } from "./themes";

const STORAGE_KEY = "dataset-studio.preferences";

interface AppPreferencesState {
  preferences: AppPreferences;
  setTheme: (themeId: ThemeId) => void;
  setThemeCustomBackground: (themeId: ThemeId, background: CustomBackground | null) => void;
  setSceneOverrides: (target: SceneTarget, update: Partial<SceneOverrides>) => void;
  resetSceneOverrides: (target: SceneTarget) => void;
  setRegionTransparency: (region: AppSurfaceRegion, transparent: boolean) => void;
  setAllRegionsTransparent: () => void;
  resetRegionTransparency: () => void;
  setImmersiveMode: (enabled: boolean) => void;
}

function readStoredPreferences(): AppPreferences {
  if (typeof window === "undefined") return normalizePreferences(null);

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? normalizePreferences(JSON.parse(raw)) : normalizePreferences(null);
  } catch {
    return normalizePreferences(null);
  }
}

function persistPreferences(preferences: AppPreferences) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
  } catch {
    // Appearance changes should remain usable for this session when browser
    // storage is unavailable or full.
  }
}

const initialPreferences = readStoredPreferences();

export const useAppPreferences = create<AppPreferencesState>((set) => {
  const commit = (update: (current: AppPreferences) => AppPreferences) => {
    set((state) => {
      const preferences = normalizePreferences(update(state.preferences));
      persistPreferences(preferences);
      applyPreferences(preferences);
      return { preferences };
    });
  };

  return {
    preferences: initialPreferences,
    setTheme: (themeId) => commit((current) => ({ ...current, themeId })),
    setThemeCustomBackground: (themeId, customBackground) =>
      commit((current) => {
        const customBackgrounds = { ...current.appearance.customBackgrounds };
        if (customBackground) customBackgrounds[themeId] = customBackground;
        else delete customBackgrounds[themeId];

        return {
          ...current,
          appearance: { ...current.appearance, customBackgrounds },
        };
      }),
    setSceneOverrides: (target, update) =>
      commit((current) => ({
        ...current,
        appearance: {
          ...current.appearance,
          [target]: { ...current.appearance[target], ...update },
        },
      })),
    resetSceneOverrides: (target) =>
      commit((current) => ({
        ...current,
        appearance: {
          ...current.appearance,
          [target]: { opacity: null, blurPx: null },
        },
      })),
    setRegionTransparency: (region, transparent) =>
      commit((current) => ({
        ...current,
        appearance: {
          ...current.appearance,
          transparentRegions: {
            ...current.appearance.transparentRegions,
            [region]: transparent,
          },
        },
      })),
    setAllRegionsTransparent: () =>
      commit((current) => ({
        ...current,
        appearance: {
          ...current.appearance,
          transparentRegions: createUniformSurfaceTransparency(true),
        },
      })),
    resetRegionTransparency: () =>
      commit((current) => ({
        ...current,
        appearance: {
          ...current.appearance,
          transparentRegions: createDefaultSurfaceTransparency(),
        },
      })),
    setImmersiveMode: (immersiveMode) =>
      commit((current) => ({
        ...current,
        appearance: { ...current.appearance, immersiveMode },
      })),
  };
});

export function initializeAppPreferences() {
  const preferences = useAppPreferences.getState().preferences;
  persistPreferences(preferences);
  applyPreferences(preferences);
}
