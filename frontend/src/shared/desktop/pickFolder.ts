import { open } from "@tauri-apps/plugin-dialog";

function isTauriRuntime(): boolean {
  return "__TAURI_INTERNALS__" in window;
}

export async function pickWorkspaceFolder(): Promise<string | null> {
  if (isTauriRuntime()) {
    const selected = await open({
      directory: true,
      multiple: false,
      title: "选择数据集工作区",
    });
    return typeof selected === "string" ? selected : null;
  }

  return window.prompt("输入要打开的工作区文件夹绝对路径：")?.trim() || null;
}
