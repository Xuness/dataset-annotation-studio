import { ArchiveRestore, RotateCcw } from "lucide-react";

import type { PreprocessOperation } from "../../../shared/api/types";
import { Button } from "../../../shared/ui/Button";
import { Spinner } from "../../../shared/ui/Spinner";
import {
  activePreprocessStatuses,
  executionModeLabels,
  formatDurationMilliseconds,
  formatDurationSeconds,
  preprocessEtaSeconds,
  preprocessOptionDetails,
  preprocessProgress,
  preprocessProgressCountLabel,
  preprocessStageLabel,
  preprocessStatusLabels,
} from "../operationProgress";

export function PreprocessHistoryPanel({
  operations,
  selectedOperationId,
  undoPending,
  onSelect,
  onUndo,
}: {
  operations: PreprocessOperation[];
  selectedOperationId: string | null;
  undoPending: boolean;
  onSelect: (id: string) => void;
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
          const details = preprocessOptionDetails(operation);
          const runtime = operation.runtime;
          const active = activePreprocessStatuses.has(operation.status);
          const selected = operation.id === selectedOperationId;
          const progress = preprocessProgress(operation);
          const etaSeconds = preprocessEtaSeconds(operation);
          const routeReasonCount = runtime
            ? Object.values(runtime.route_reason_counts).reduce((total, count) => total + count, 0)
            : 0;
          const fallbackCount = runtime
            ? Object.values(runtime.fallback_counts).reduce((total, count) => total + count, 0)
            : 0;
          return (
            <article
              key={operation.id}
              className={`${active ? "is-active" : ""} ${selected ? "is-selected" : ""}`.trim()}
            >
              <button
                type="button"
                className="preprocess-history-selection"
                aria-label={`查看 ${operation.item_count} 张图片的预处理任务详情`}
                aria-pressed={selected}
                onClick={() => onSelect(operation.id)}
              >
                <header>
                  <strong>{operation.item_count} 张图片</strong>
                  <span>
                    {operation.status === "completed"
                      ? "可撤销"
                      : (preprocessStatusLabels[operation.status] ?? operation.status)}
                  </span>
                </header>
                <small>{new Date(operation.created_at).toLocaleString()}</small>
                <p>{details.join(" · ")}</p>
                <div
                  className={`preprocess-progress-track ${
                    active && (!progress.determinate || progress.completed === 0)
                      ? "is-indeterminate"
                      : ""
                  }`}
                  role="progressbar"
                  aria-label="预处理任务进度"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={progress.determinate ? progress.percent : undefined}
                >
                  <span style={{ width: `${progress.percent}%` }} />
                </div>
                <small className="preprocess-history-progress-copy">
                  {preprocessProgressCountLabel(operation)} · {preprocessStageLabel(operation)}
                </small>
                {active && etaSeconds !== null ? (
                  <small>预计剩余 {formatDurationSeconds(etaSeconds)}</small>
                ) : active && !progress.determinate ? (
                  <small>重启后端后可显示实时 ETA</small>
                ) : null}
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
                      {formatDurationMilliseconds(runtime.duration_ms)} · CPU {runtime.worker_count}{" "}
                      线程 · 批大小 {runtime.batch_size}
                    </small>
                    {routeReasonCount ? (
                      <small>能力或策略选择 CPU：{routeReasonCount} 项</small>
                    ) : null}
                    {fallbackCount ? <small>加速运行时回退：{fallbackCount} 项</small> : null}
                  </div>
                ) : null}
              </button>
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
