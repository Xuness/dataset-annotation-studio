import { ArchiveRestore, RotateCcw } from "lucide-react";

import type { PreprocessOperation } from "../../../shared/api/types";
import { Button } from "../../../shared/ui/Button";
import { Spinner } from "../../../shared/ui/Spinner";

const resizeAlgorithmLabels = {
  lanczos3: "Lanczos 3",
  lanczos4: "Lanczos 4",
  anime_low_halo: "二次元低光晕",
} as const;

const executionModeLabels = {
  auto: "自动选择",
  cpu_only: "仅 CPU",
  prefer_accelerator: "优先硬件加速",
} as const;

function formatDuration(milliseconds: number): string {
  if (milliseconds < 1000) return `${milliseconds} ms`;
  const seconds = milliseconds / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)} 秒`;
  return `${Math.floor(seconds / 60)} 分 ${Math.round(seconds % 60)} 秒`;
}

export function PreprocessHistoryPanel({
  operations,
  undoPending,
  onUndo,
}: {
  operations: PreprocessOperation[];
  undoPending: boolean;
  onUndo: (id: string) => void;
}) {
  const latestCompleted = operations.find((operation) => operation.status === "completed");
  return (
    <aside className="preprocess-history" data-surface-region="secondary-sidebar">
      <header>
        <ArchiveRestore size={16} />
        <div>
          <span className="eyebrow">Project recovery</span>
          <h2>项目恢复记录</h2>
        </div>
      </header>
      <p>原图保存在当前项目内部，跟随整个文件夹移动，并且不会出现在素材列表。</p>
      <div>
        {operations.map((operation) => {
          const details = [
            operation.options.resize
              ? `最长边 ${operation.options.resize.max_edge} · ${
                  resizeAlgorithmLabels[operation.options.resize.algorithm]
                }`
              : null,
            operation.options.convert ? operation.options.convert.format.toUpperCase() : null,
            operation.options.rename ? `重命名 ${operation.options.rename.template}` : null,
          ].filter(Boolean);
          const runtime = operation.runtime;
          const routeReasonCount = runtime
            ? Object.values(runtime.route_reason_counts).reduce((total, count) => total + count, 0)
            : 0;
          const fallbackCount = runtime
            ? Object.values(runtime.fallback_counts).reduce((total, count) => total + count, 0)
            : 0;
          return (
            <article key={operation.id}>
              <header>
                <strong>{operation.item_count} 张图片</strong>
                <span>
                  {operation.status === "completed"
                    ? "可撤销"
                    : operation.status === "undone"
                      ? "已撤销"
                      : operation.status === "failed"
                        ? "失败"
                        : operation.status === "running"
                          ? "进行中"
                          : operation.status}
                </span>
              </header>
              <small>{new Date(operation.created_at).toLocaleString()}</small>
              <p>{details.join(" · ")}</p>
              {runtime ? (
                <div className="preprocess-history-runtime">
                  <strong>
                    {executionModeLabels[runtime.requested_mode]} → {runtime.backend_label}
                  </strong>
                  <span>
                    {runtime.route_counts.accelerated_full ?? 0} 加速管线 ·{" "}
                    {runtime.route_counts.accelerated_resize ?? 0} 加速缩放 ·{" "}
                    {runtime.route_counts.cpu ?? 0} CPU
                  </span>
                  <small>
                    {formatDuration(runtime.duration_ms)} · CPU {runtime.worker_count} 线程 · 批大小{" "}
                    {runtime.batch_size}
                  </small>
                  {routeReasonCount ? (
                    <small>能力或策略选择 CPU：{routeReasonCount} 项</small>
                  ) : null}
                  {fallbackCount ? <small>加速运行时回退：{fallbackCount} 项</small> : null}
                </div>
              ) : null}
              {operation.error_message ? (
                <p className="form-error">{operation.error_message}</p>
              ) : null}
              {operation.id === latestCompleted?.id ? (
                <Button
                  icon={undoPending ? <Spinner /> : <RotateCcw size={13} />}
                  disabled={undoPending}
                  onClick={() => onUndo(operation.id)}
                >
                  撤销这次处理
                </Button>
              ) : null}
            </article>
          );
        })}
      </div>
    </aside>
  );
}
