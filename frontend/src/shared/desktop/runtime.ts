import { convertFileSrc, isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";

export function isDesktopRuntime(): boolean {
  return isTauri();
}

export function resolveDesktopAssetUrl(path: string): string {
  return isDesktopRuntime() ? convertFileSrc(path) : path;
}

export async function setDesktopWindowTheme(theme: "light" | "dark" | null): Promise<void> {
  if (!isDesktopRuntime()) return;
  await getCurrentWindow().setTheme(theme);
}
