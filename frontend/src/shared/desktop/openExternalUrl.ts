import { openUrl } from "@tauri-apps/plugin-opener";

function isTauriRuntime(): boolean {
  return "__TAURI_INTERNALS__" in window;
}

export async function openExternalUrl(url: string): Promise<void> {
  if (isTauriRuntime()) {
    await openUrl(url);
    return;
  }
  const opened = window.open(url, "_blank", "noopener,noreferrer");
  if (!opened) throw new Error("浏览器阻止了授权窗口，请允许弹出窗口后重试。");
}
