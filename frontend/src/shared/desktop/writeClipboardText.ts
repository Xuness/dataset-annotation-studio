import { invoke, isTauri } from "@tauri-apps/api/core";

const WRITE_COMMAND = "write_clipboard_text_with_history";

export async function writeClipboardText(text: string): Promise<void> {
  if (isTauri()) {
    const written = await invoke<boolean>(WRITE_COMMAND, { text });
    if (!written) throw new Error("系统剪贴板正忙，请稍后重试。");
    return;
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
