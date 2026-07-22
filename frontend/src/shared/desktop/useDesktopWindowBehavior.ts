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

interface DesktopFullscreenWindow {
  isFullscreen(): Promise<boolean>;
  isMaximized(): Promise<boolean>;
  maximize(): Promise<void>;
  setFullscreen(fullscreen: boolean): Promise<void>;
  unmaximize(): Promise<void>;
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

export function createDesktopFullscreenToggle(
  appWindow: DesktopFullscreenWindow,
  normalizeMaximizedWindow: boolean,
): () => Promise<boolean> {
  let restoreMaximizedOnExit = false;

  return async () => {
    const fullscreen = await appWindow.isFullscreen();
    if (fullscreen) {
      await appWindow.setFullscreen(false);
      if (restoreMaximizedOnExit) {
        restoreMaximizedOnExit = false;
        await appWindow.maximize();
      }
      return false;
    }

    const maximized = normalizeMaximizedWindow && (await appWindow.isMaximized());
    if (maximized) await appWindow.unmaximize();

    try {
      await appWindow.setFullscreen(true);
    } catch (error) {
      if (maximized) await appWindow.maximize().catch(() => undefined);
      throw error;
    }

    restoreMaximizedOnExit = maximized;
    return true;
  };
}

export function useDesktopWindowBehavior(): void {
  useEffect(() => {
    if (!isTauri()) return;

    const appWindow = getCurrentWindow();
    // On Windows, entering borderless fullscreen directly from a maximized,
    // undecorated window can leave the WebView constrained to the taskbar work
    // area. Normalize that native state first, then restore it after F11 exits.
    const toggleFullscreen = createDesktopFullscreenToggle(
      appWindow,
      /Windows/i.test(navigator.userAgent),
    );
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
      void toggleFullscreen()
        .then((nextFullscreen) => {
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
