import { invoke, isTauri } from "@tauri-apps/api/core";
import { useEffect } from "react";

const WRITE_COMMAND = "write_clipboard_text_with_history";
const RETRY_DELAYS_MS = [0, 25, 75] as const;

let writeQueue: Promise<void> = Promise.resolve();

type ClipboardOperation = "copy" | "cut";

interface PendingClipboardShortcut {
  operation: ClipboardOperation;
  text: string;
  timeoutId: number;
}

function selectedControlText(target: EventTarget | null): string | null {
  if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) {
    return null;
  }

  if (target instanceof HTMLInputElement && target.type === "password") {
    return null;
  }

  const start = target.selectionStart;
  const end = target.selectionEnd;
  if (start === null || end === null || start === end) {
    return null;
  }

  return target.value.slice(start, end);
}

function selectedText(target: EventTarget | null): string | null {
  if (target instanceof HTMLInputElement && target.type === "password") {
    return null;
  }

  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
    return selectedControlText(target);
  }

  const selectionText = window.getSelection()?.toString() ?? "";
  return selectionText.length > 0 ? selectionText : null;
}

function clipboardEventText(event: ClipboardEvent): string | null {
  if (event.target instanceof HTMLInputElement && event.target.type === "password") {
    return null;
  }

  const explicitText = event.clipboardData?.getData("text/plain");
  if (explicitText) {
    return explicitText;
  }

  return selectedText(event.target);
}

function clipboardShortcutOperation(event: KeyboardEvent): ClipboardOperation | null {
  if (event.defaultPrevented || event.repeat || !event.ctrlKey || event.metaKey || event.altKey) {
    return null;
  }

  const key = event.key.toLowerCase();
  if (key === "c") return "copy";
  if (key === "x") return "cut";
  return null;
}

function wait(delayMs: number): Promise<void> {
  if (delayMs === 0) {
    return Promise.resolve();
  }

  return new Promise((resolve) => window.setTimeout(resolve, delayMs));
}

async function writeTextWithRetry(text: string): Promise<void> {
  let lastError: unknown;

  for (const delayMs of RETRY_DELAYS_MS) {
    await wait(delayMs);

    try {
      if (await invoke<boolean>(WRITE_COMMAND, { text })) {
        return;
      }
      lastError = new Error("the Windows clipboard was busy");
    } catch (error) {
      lastError = error;
    }
  }

  // The WebView's normal copy already happened, so a bridge failure must not
  // interfere with Ctrl+C/Ctrl+V.
  console.warn("Could not add copied text to Windows clipboard history.", lastError);
}

function enqueueClipboardWrite(text: string): void {
  writeQueue = writeQueue.then(
    () => writeTextWithRetry(text),
    () => writeTextWithRetry(text),
  );
}

export function useClipboardHistoryBridge(): void {
  useEffect(() => {
    if (!isTauri() || !/Windows/i.test(navigator.userAgent)) {
      return;
    }

    let pendingShortcut: PendingClipboardShortcut | null = null;

    const clearPendingShortcut = () => {
      if (pendingShortcut) {
        window.clearTimeout(pendingShortcut.timeoutId);
        pendingShortcut = null;
      }
    };

    const handleShortcutKeyDown = (event: KeyboardEvent) => {
      const operation = clipboardShortcutOperation(event);
      if (!operation) return;
      const text = selectedText(event.target);
      if (text === null) return;

      clearPendingShortcut();
      const timeoutId = window.setTimeout(() => {
        if (!pendingShortcut || pendingShortcut.timeoutId !== timeoutId) return;
        if (event.defaultPrevented) {
          pendingShortcut = null;
          return;
        }
        const fallbackText = pendingShortcut.text;
        pendingShortcut = null;
        enqueueClipboardWrite(fallbackText);
      }, 0);
      pendingShortcut = { operation, text, timeoutId };
    };

    const handleClipboardEvent = (event: ClipboardEvent) => {
      const operation: ClipboardOperation = event.type === "cut" ? "cut" : "copy";
      const shortcutText = pendingShortcut?.operation === operation ? pendingShortcut.text : null;
      clearPendingShortcut();
      const text = clipboardEventText(event) ?? shortcutText;
      if (text !== null) {
        enqueueClipboardWrite(text);
      }
    };

    // Snapshot the selection before WebView2 handles the accelerator. Normal
    // copy/cut events cancel this fallback; if WebView2 omits one, the native
    // history bridge still receives the exact shortcut selection.
    document.addEventListener("keydown", handleShortcutKeyDown, true);
    document.addEventListener("copy", handleClipboardEvent);
    document.addEventListener("cut", handleClipboardEvent);

    return () => {
      clearPendingShortcut();
      document.removeEventListener("keydown", handleShortcutKeyDown, true);
      document.removeEventListener("copy", handleClipboardEvent);
      document.removeEventListener("cut", handleClipboardEvent);
    };
  }, []);
}
