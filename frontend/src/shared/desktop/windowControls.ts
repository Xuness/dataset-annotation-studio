import { getCurrentWindow } from "@tauri-apps/api/window";

import { isDesktopRuntime } from "./runtime";
import { usesNativeWindowDecorations } from "./runtimePlatform";

export function usesCustomDesktopTitlebar(): boolean {
  return isDesktopRuntime() && !usesNativeWindowDecorations();
}

export async function minimizeDesktopWindow(): Promise<void> {
  await getCurrentWindow().minimize();
}

export async function toggleDesktopWindowMaximized(): Promise<void> {
  await getCurrentWindow().toggleMaximize();
}

export async function closeDesktopWindow(): Promise<void> {
  await getCurrentWindow().close();
}
