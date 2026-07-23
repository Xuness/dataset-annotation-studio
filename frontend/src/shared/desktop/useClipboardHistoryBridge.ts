import { invoke, isTauri } from "@tauri-apps/api/core";
import { useEffect } from "react";

const WRITE_COMMAND = "write_clipboard_text_with_history";
const RETRY_DELAYS_MS = [0, 25, 75] as const;

let writeQueue: Promise<void> = Promise.resolve();

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

function clipboardEventText(event: ClipboardEvent): string | null {
  if (event.target instanceof HTMLInputElement && event.target.type === "password") {
    return null;
  }

  const explicitText = event.clipboardData?.getData("text/plain");
  if (explicitText) {
    return explicitText;
  }

  const controlText = selectedControlText(event.target);
  if (controlText) {
    return controlText;
  }

  const selectionText = window.getSelection()?.toString() ?? "";
  return selectionText.length > 0 ? selectionText : null;
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

    const handleClipboardEvent = (event: ClipboardEvent) => {
      const text = clipboardEventText(event);
      if (text !== null) {
        enqueueClipboardWrite(text);
      }
    };

    document.addEventListener("copy", handleClipboardEvent);
    document.addEventListener("cut", handleClipboardEvent);

    return () => {
      document.removeEventListener("copy", handleClipboardEvent);
      document.removeEventListener("cut", handleClipboardEvent);
    };
  }, []);
}
