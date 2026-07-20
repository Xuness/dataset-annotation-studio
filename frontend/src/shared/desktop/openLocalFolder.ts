import { openPath } from "@tauri-apps/plugin-opener";

function isTauriRuntime(): boolean {
  return "__TAURI_INTERNALS__" in window;
}

export async function openLocalFolder(path: string): Promise<void> {
  if (!isTauriRuntime()) {
    throw new Error("只有桌面版可以直接打开本地文件夹。");
  }
  await openPath(path);
}
