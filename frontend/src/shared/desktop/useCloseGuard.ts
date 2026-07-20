import { useEffect } from "react";
import { confirm, message } from "@tauri-apps/plugin-dialog";
import { getCurrentWindow } from "@tauri-apps/api/window";

import { getActiveJobs, stopAllWorkspaceJobs } from "../../features/jobs/api";
import { useAppStore } from "../store/appStore";

function isTauriRuntime(): boolean {
  return "__TAURI_INTERNALS__" in window;
}

export function useCloseGuard(): void {
  const hasUnsavedChanges = useAppStore((state) => Object.keys(state.dirtyScopes).length > 0);

  useEffect(() => {
    if (!hasUnsavedChanges) return;
    const preventAccidentalUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", preventAccidentalUnload);
    return () => window.removeEventListener("beforeunload", preventAccidentalUnload);
  }, [hasUnsavedChanges]);

  useEffect(() => {
    if (!isTauriRuntime()) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;

    void getCurrentWindow()
      .onCloseRequested(async (event) => {
        event.preventDefault();
        try {
          if (hasUnsavedChanges) {
            const discard = await confirm("当前还有尚未保存的修改，仍要关闭软件吗？", {
              title: "尚未保存",
              kind: "warning",
            });
            if (!discard) return;
          }
          const active = await getActiveJobs();
          if (active.preprocessing_count) {
            await message("图片预处理或撤销正在写入文件，请等待操作完成后再关闭软件。", {
              title: "暂时无法关闭",
              kind: "warning",
            });
            return;
          }
          const stoppableJobs =
            active.annotation_job_count + active.translation_job_count + active.export_count;
          if (!stoppableJobs) {
            await getCurrentWindow().destroy();
            return;
          }
          const accepted = await confirm(
            `还有 ${stoppableJobs} 个标注、翻译或导出任务尚未结束。关闭软件会安全停止任务并保留断点，仍要退出吗？`,
            { title: "停止任务并退出", kind: "warning" },
          );
          if (!accepted) return;
          try {
            await stopAllWorkspaceJobs();
            for (let attempt = 0; attempt < 20; attempt += 1) {
              await new Promise((resolve) => window.setTimeout(resolve, 250));
              const remaining = await getActiveJobs();
              if (
                !remaining.annotation_job_count &&
                !remaining.translation_job_count &&
                !remaining.export_count
              )
                break;
            }
          } finally {
            await getCurrentWindow().destroy();
          }
        } catch {
          const forceClose = await confirm(
            "无法确认后台是否仍在写入文件。强制关闭可能导致当前操作不完整，仍要关闭吗？",
            { title: "确认关闭", kind: "warning" },
          );
          if (forceClose) await getCurrentWindow().destroy();
        }
      })
      .then((stopListening) => {
        if (disposed) stopListening();
        else unlisten = stopListening;
      });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [hasUnsavedChanges]);
}
