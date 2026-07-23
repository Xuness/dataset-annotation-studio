export const DESKTOP_EXIT_REQUESTED_EVENT = "desktop-exit-requested";
export const EXIT_APPLICATION_COMMAND = "exit_application";

export interface ActiveDesktopJobs {
  annotation_job_count: number;
  translation_job_count: number;
  preprocessing_count: number;
  export_count: number;
  asset_deletion_count: number;
  tagger_download_count: number;
}

interface WarningDialogOptions {
  title: string;
  kind: "warning";
}

export interface DesktopExitDependencies {
  confirm: (message: string, options: WarningDialogOptions) => Promise<boolean>;
  message: (message: string, options: WarningDialogOptions) => Promise<unknown>;
  getActiveJobs: () => Promise<ActiveDesktopJobs>;
  stopAllWorkspaceJobs: () => Promise<unknown>;
  delay: (milliseconds: number) => Promise<void>;
  exitApplication: () => Promise<void>;
}

export type DesktopExitResult = "cancelled" | "blocked" | "exiting";

function stoppableJobCount(active: ActiveDesktopJobs): number {
  return (
    active.annotation_job_count +
    active.translation_job_count +
    active.export_count +
    active.tagger_download_count
  );
}

function hasBlockingFileOperation(active: ActiveDesktopJobs): boolean {
  return Boolean(active.preprocessing_count || active.asset_deletion_count);
}

function hasStoppableJobs(active: ActiveDesktopJobs): boolean {
  return stoppableJobCount(active) > 0;
}

export async function runDesktopExit(
  hasUnsavedChanges: boolean,
  dependencies: DesktopExitDependencies,
): Promise<DesktopExitResult> {
  try {
    if (hasUnsavedChanges) {
      const discard = await dependencies.confirm("当前还有尚未保存的修改，仍要关闭软件吗？", {
        title: "尚未保存",
        kind: "warning",
      });
      if (!discard) return "cancelled";
    }

    const active = await dependencies.getActiveJobs();
    if (hasBlockingFileOperation(active)) {
      await dependencies.message(
        "图片预处理、素材删除或恢复正在写入文件，请等待操作完成后再关闭软件。",
        {
          title: "暂时无法关闭",
          kind: "warning",
        },
      );
      return "blocked";
    }

    const stoppableJobs = stoppableJobCount(active);
    if (stoppableJobs) {
      const accepted = await dependencies.confirm(
        `还有 ${stoppableJobs} 个标注、翻译、导出或模型下载任务尚未结束。关闭软件会安全停止任务并保留断点，仍要退出吗？`,
        { title: "停止任务并退出", kind: "warning" },
      );
      if (!accepted) return "cancelled";

      await dependencies.stopAllWorkspaceJobs();
      let remaining = active;
      for (let attempt = 0; attempt < 20; attempt += 1) {
        await dependencies.delay(250);
        remaining = await dependencies.getActiveJobs();
        if (!hasStoppableJobs(remaining)) break;
      }
      if (hasStoppableJobs(remaining)) {
        throw new Error("Background jobs did not stop before the exit deadline.");
      }
    }

    await dependencies.exitApplication();
    return "exiting";
  } catch {
    const forceClose = await dependencies.confirm(
      "无法确认后台是否仍在写入文件。强制关闭可能导致当前操作不完整，仍要关闭吗？",
      { title: "确认关闭", kind: "warning" },
    );
    if (!forceClose) return "cancelled";
    await dependencies.exitApplication();
    return "exiting";
  }
}
