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
    let disposed = false;
    let stopListeningForResize: (() => void) | undefined;

    const syncFullscreenState = () => {
      void appWindow
        .isFullscreen()
        .then((fullscreen) => {
          if (!disposed) document.documentElement.dataset.desktopFullscreen = String(fullscreen);
        })
        .catch(() => undefined);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (!isFullscreenShortcut(event)) return;
      event.preventDefault();
      if (togglingFullscreen) return;

      togglingFullscreen = true;
      void appWindow
        .isFullscreen()
        .then(async (fullscreen) => {
          const nextFullscreen = !fullscreen;
          await appWindow.setFullscreen(nextFullscreen);
          document.documentElement.dataset.desktopFullscreen = String(nextFullscreen);
        })
        .catch(() => undefined)
        .finally(() => {
          togglingFullscreen = false;
        });
    };

    syncFullscreenState();
    void appWindow.onResized(syncFullscreenState).then((stopListening) => {
      if (disposed) stopListening();
      else stopListeningForResize = stopListening;
    });
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      disposed = true;
      stopListeningForResize?.();
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);
}
