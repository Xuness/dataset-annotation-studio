import { FolderOpen, Pause, Play, Rows3 } from "lucide-react";

import type { ExportOperation, ExportOperationStatus } from "../../../../src/shared/api/types";
import { formatBytes } from "../../../../src/shared/format/bytes";
import { Button } from "../../../shared/ui/Button";
import { Spinner } from "../../../shared/ui/Spinner";

const statusLabels: Record<ExportOperationStatus, string> = {
  queued: "等待开始",
  running: "正在导出",
  stopping: "正在停止",
  stopped: "已停止",
  interrupted: "意外中断",
  completed: "已完成",
  failed: "失败",
};

export function ExportHistoryPanel({
  operations,
  actionPending,
  onStop,
  onResume,
  onOpenFolder,
}: {
  operations: ExportOperation[];
  actionPending: boolean;
  onStop: (operationId: string) => void;
  onResume: (operationId: string) => void;
  onOpenFolder: (path: string) => void;
}) {
  return (
    <aside className="export-history" data-surface-region="secondary-sidebar">
      <header>
        <Rows3 size={17} />
        <div>
          <span className="eyebrow">Project task state</span>
          <h2>导出进度</h2>
        </div>
      </header>
      <p>进度和任务记录保存在当前项目的工作区数据库中，导出目录不写入清单。</p>

      <div className="export-history__list">
        {operations.map((operation) => {
          const active = ["queued", "running", "stopping"].includes(operation.status);
          const resumable = ["stopped", "interrupted"].includes(operation.status);
          const progress = operation.total_items
            ? Math.round((operation.completed_items / operation.total_items) * 100)
            : 0;
          const channels =
            operation.configuration_snapshot.channels
              ?.map((selection) =>
                selection.channel === "translation"
                  ? `translation:${selection.translation_source_kind ?? "description"}:${
                      selection.translation_producer_kind ?? "llm"
                    }:${selection.language}`
                  : selection.channel,
              )
              .join(" · ") ?? "旧版导出";
          const formats = operation.configuration_snapshot.formats?.join(" + ") ?? "txt";
          const packaging = operation.configuration_snapshot.packaging === "zip" ? "ZIP" : "文件夹";
          const directoryLayout = operation.configuration_snapshot.directory_layout;
          const directoryLabel =
            !directoryLayout || directoryLayout.mode === "flat"
              ? "扁平化"
              : directoryLayout.mode === "preserve"
                ? "保留原目录（含根目录名）"
                : `自定义合并 ${directoryLayout.merge_into_parent_paths?.length ?? 0} 个目录`;
          return (
            <article key={operation.id} className={active ? "is-active" : ""}>
              <header>
                <strong>{statusLabels[operation.status]}</strong>
                <span>{progress}%</span>
              </header>
              <div className="export-progress-track" aria-label={`导出进度 ${progress}%`}>
                <span style={{ width: `${progress}%` }} />
              </div>
              <p title={operation.destination_path}>{operation.destination_path}</p>
              <small>
                {operation.completed_items} / {operation.total_items} 张 ·{" "}
                {formatBytes(operation.copied_bytes, "KB")} /
                {formatBytes(operation.total_bytes, "KB")}
              </small>
              <small title={channels}>
                {packaging} · {directoryLabel} · {formats.toUpperCase()} · {channels}
              </small>
              {operation.current_relative_path ? (
                <small title={operation.current_relative_path}>
                  当前：{operation.current_relative_path}
                </small>
              ) : null}
              {operation.warning_count ? (
                <small>包含 {operation.warning_count} 个已接受警告</small>
              ) : null}
              {operation.error_message ? (
                <p className="form-error">{operation.error_message}</p>
              ) : null}
              <div className="export-history__actions">
                <Button
                  icon={<FolderOpen size={13} />}
                  disabled={actionPending}
                  onClick={() => onOpenFolder(operation.destination_path)}
                >
                  打开目录
                </Button>
                {active ? (
                  <Button
                    icon={actionPending ? <Spinner /> : <Pause size={13} />}
                    disabled={actionPending || operation.status === "stopping"}
                    onClick={() => onStop(operation.id)}
                  >
                    停止
                  </Button>
                ) : null}
                {resumable ? (
                  <Button
                    icon={actionPending ? <Spinner /> : <Play size={13} />}
                    disabled={actionPending}
                    onClick={() => onResume(operation.id)}
                  >
                    继续
                  </Button>
                ) : null}
              </div>
            </article>
          );
        })}
        {!operations.length ? <div className="export-history__empty">还没有导出记录。</div> : null}
      </div>
    </aside>
  );
}
