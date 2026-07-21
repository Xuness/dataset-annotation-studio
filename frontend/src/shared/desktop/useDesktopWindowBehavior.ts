import { useEffect } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";

interface FullscreenShortcutEvent {
  key: string;
  repeat: boolean;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}

export function isFullscreenShortcut(event: FullscreenShortcutEvent): boolean {
  return (
    event.key === "F11" &&
    !event.repeat &&
    !event.altKey &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.shiftKey
  );
}

export function useDesktopWindowBehavior(): void {
  useEffect(() => {
    if (!isTauri()) return;

    const appWindow = getCurrentWindow();
    let togglingFullscreen = false;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (!isFullscreenShortcut(event)) return;
      event.preventDefault();
      if (togglingFullscreen) return;

      togglingFullscreen = true;
      void appWindow
        .isFullscreen()
        .then((fullscreen) => appWindow.setFullscreen(!fullscreen))
        .catch(() => undefined)
        .finally(() => {
          togglingFullscreen = false;
        });
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);
}
