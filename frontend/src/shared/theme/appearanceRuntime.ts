import { convertFileSrc, isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";

import {
  filterTransparentRegionsForWindowDecorations,
  usesNativeDesktopWindowDecorations,
} from "../desktop/runtimePlatform";
import {
  APP_SURFACE_REGIONS,
  resolveAppearance,
  resolveSurfaceTransparency,
  type AppPreferences,
} from "./appearance";

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
  const surfaceTransparency = resolveSurfaceTransparency(preferences.appearance);

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
  root.dataset.transparentRegions = filterTransparentRegionsForWindowDecorations(
    APP_SURFACE_REGIONS.filter((region) => surfaceTransparency[region]),
    usesNativeDesktopWindowDecorations(isTauri()),
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
