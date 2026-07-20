import { open } from "@tauri-apps/plugin-dialog";

function isTauriRuntime(): boolean {
  return "__TAURI_INTERNALS__" in window;
}

export async function pickWorkspaceFolder(): Promise<string | null> {
  return pickFolder("选择数据集工作区", "输入要打开的工作区文件夹绝对路径：");
}

export async function pickExportFolder(): Promise<string | null> {
  return pickFolder("选择空的导出文件夹", "输入用于存放图片和同名 TXT 的空文件夹绝对路径：");
}

async function pickFolder(title: string, fallbackPrompt: string): Promise<string | null> {
  if (isTauriRuntime()) {
    const selected = await open({
      directory: true,
      multiple: false,
      title,
    });
    return typeof selected === "string" ? selected : null;
  }

  return window.prompt(fallbackPrompt)?.trim() || null;
}
