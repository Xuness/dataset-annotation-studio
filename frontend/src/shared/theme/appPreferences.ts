import { convertFileSrc, isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { create } from "zustand";

import {
  createDefaultSurfaceTransparency,
  createUniformSurfaceTransparency,
  normalizePreferences,
  resolveAppearance,
  resolveWorkspaceSurfaceTransparency,
  WORKSPACE_SURFACE_REGIONS,
  type AppPreferences,
  type CustomBackground,
  type SceneOverrides,
  type SceneTarget,
  type WorkspaceSurfaceRegion,
} from "./appearance";
import type { ThemeId } from "./themes";

const STORAGE_KEY = "dataset-studio.preferences";

interface AppPreferencesState {
  preferences: AppPreferences;
  setTheme: (themeId: ThemeId) => void;
  setCustomBackground: (background: CustomBackground | null) => void;
  setSceneOverrides: (target: SceneTarget, update: Partial<SceneOverrides>) => void;
  resetSceneOverrides: (target: SceneTarget) => void;
  setRegionTransparency: (region: WorkspaceSurfaceRegion, transparent: boolean) => void;
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

function cssUrl(value: string): string {
  return `url(${JSON.stringify(value)})`;
}

function resolveImageUrl(path: string): string {
  return isTauri() ? convertFileSrc(path) : path;
}

export function applyPreferences(preferences: AppPreferences) {
  if (typeof document === "undefined") return;

  const resolved = resolveAppearance(preferences);
  const customBackground = resolved.customBackground;
  const sceneImage = customBackground
    ? resolveImageUrl(customBackground.path)
    : resolved.theme.scene.image;
  const homePresentation = customBackground
    ? { position: "center", size: "contain" }
    : resolved.theme.scene.home;
  const workspacePresentation = customBackground
    ? { position: "center", size: "cover" }
    : resolved.theme.scene.workspace;
  const root = document.documentElement;
  const surfaceTransparency = resolveWorkspaceSurfaceTransparency(preferences.appearance);

  root.dataset.theme = resolved.theme.id;
  root.dataset.themeMaterial = resolved.theme.material.id;
  root.dataset.immersiveMode = String(preferences.appearance.immersiveMode);
  root.dataset.backgroundSource = customBackground ? "custom" : "theme";
  root.style.setProperty("--home-gallery-image", cssUrl(sceneImage));
  root.style.setProperty("--home-gallery-position", homePresentation.position);
  root.style.setProperty("--home-scene-size", homePresentation.size);
  root.style.setProperty("--home-scene-filter", resolved.theme.scene.home.filter);
  root.style.setProperty("--home-scene-opacity", String(resolved.home.opacity));
  root.style.setProperty("--home-scene-blur", `${resolved.home.blurPx}px`);
  root.style.setProperty("--workspace-scene-image", cssUrl(sceneImage));
  root.style.setProperty("--workspace-scene-position", workspacePresentation.position);
  root.style.setProperty("--workspace-scene-size", workspacePresentation.size);
  root.style.setProperty("--workspace-scene-filter", resolved.theme.scene.workspace.filter);
  root.style.setProperty("--workspace-scene-opacity", String(resolved.workspace.opacity));
  root.style.setProperty("--workspace-scene-blur", `${resolved.workspace.blurPx}px`);
  root.style.setProperty(
    "--workspace-surface-opacity",
    `${resolved.theme.material.workspaceSurfaceOpacity * 100}%`,
  );
  root.dataset.transparentRegions = WORKSPACE_SURFACE_REGIONS.filter(
    (region) => surfaceTransparency[region],
  ).join(" ");
  root
    .querySelector<HTMLMetaElement>('meta[name="theme-color"]')
    ?.setAttribute("content", resolved.theme.browserThemeColor);

  if (isTauri()) {
    void getCurrentWindow()
      .setTheme(resolved.theme.nativeWindowTheme)
      .catch(() => undefined);
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
    setCustomBackground: (customBackground) =>
      commit((current) => ({
        ...current,
        appearance: { ...current.appearance, customBackground },
      })),
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
