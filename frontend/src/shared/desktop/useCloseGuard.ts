import { useEffect } from "react";
import { confirm } from "@tauri-apps/plugin-dialog";
import { getCurrentWindow } from "@tauri-apps/api/window";

import { getActiveJobs, stopAllWorkspaceJobs } from "../../features/jobs/api";

function isTauriRuntime(): boolean {
  return "__TAURI_INTERNALS__" in window;
}

export function useCloseGuard(): void {
  useEffect(() => {
    if (!isTauriRuntime()) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;

    void getCurrentWindow()
      .onCloseRequested(async (event) => {
        event.preventDefault();
        try {
          const active = await getActiveJobs();
          if (!active.count) {
            await getCurrentWindow().destroy();
            return;
          }
          const accepted = await confirm(
            `还有 ${active.count} 个标注任务尚未结束。关闭软件会停止所有请求并保留断点，仍要退出吗？`,
            { title: "停止任务并退出", kind: "warning" },
          );
          if (!accepted) return;
          try {
            await stopAllWorkspaceJobs();
          } finally {
            await getCurrentWindow().destroy();
          }
        } catch {
          // If the local backend is already unavailable, destroy the window explicitly.
          await getCurrentWindow().destroy();
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
  }, []);
}
