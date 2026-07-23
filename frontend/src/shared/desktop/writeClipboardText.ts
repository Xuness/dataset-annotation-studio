import { invoke, isTauri } from "@tauri-apps/api/core";

const WRITE_COMMAND = "write_clipboard_text_with_history";

export async function writeClipboardText(text: string): Promise<void> {
  if (isTauri()) {
    try {
      const written = await invoke<boolean>(WRITE_COMMAND, { text });
      if (written) return;
    } catch {
      // Non-Windows runtimes and temporarily unavailable native clipboards
      // continue through the WebView fallback below.
    }
  }

  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const control = document.createElement("textarea");
  control.value = text;
  control.style.position = "fixed";
  control.style.opacity = "0";
  document.body.append(control);
  control.select();
  const copied = document.execCommand("copy");
  control.remove();
  if (!copied) throw new Error("浏览器未开放剪贴板权限。");
}
