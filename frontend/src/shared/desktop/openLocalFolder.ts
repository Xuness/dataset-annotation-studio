import { invoke } from "@tauri-apps/api/core";

export const OPEN_DIRECTORY_COMMAND = "open_directory";

function isTauriRuntime(): boolean {
  return "__TAURI_INTERNALS__" in window;
}

export async function openLocalFolder(path: string): Promise<void> {
  if (!isTauriRuntime()) {
    throw new Error("只有桌面版可以直接打开本地文件夹。");
  }
  try {
    await invoke(OPEN_DIRECTORY_COMMAND, { path });
  } catch (reason) {
    if (reason instanceof Error) throw reason;
    throw new Error(typeof reason === "string" ? reason : "桌面运行时拒绝打开这个目录。");
  }
}
