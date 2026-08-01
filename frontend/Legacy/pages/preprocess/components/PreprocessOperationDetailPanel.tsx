import { ArrowLeft, Clock3, Cpu, Gauge, ImageIcon } from "lucide-react";

import type { PreprocessOperation } from "../../../../src/shared/api/types";
import { Button } from "../../../shared/ui/Button";
import {
  activePreprocessStatuses,
  elapsedSeconds,
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

export function PreprocessOperationDetailPanel({
  operation,
  onBack,
}: {
  operation: PreprocessOperation;
  onBack: () => void;
}) {
  const active = activePreprocessStatuses.has(operation.status);
  const progress = preprocessProgress(operation);
  const etaSeconds = preprocessEtaSeconds(operation);
  const optionDetails = preprocessOptionDetails(operation);
  const runtime = operation.runtime;
  const elapsed = elapsedSeconds(operation);
  const routeReasonCount = runtime
    ? Object.values(runtime.route_reason_counts).reduce((total, count) => total + count, 0)
    : 0;
  const fallbackCount = runtime
    ? Object.values(runtime.fallback_counts).reduce((total, count) => total + count, 0)
    : 0;

  return (
    <section
      className="preprocess-operation-detail workspace-scene-surface"
      data-surface-region="content"
    >
      <header>
        <div>
          <span className="eyebrow">Preprocessing task</span>
          <h2>预处理任务详情</h2>
        </div>
        <div className="preprocess-operation-detail__header-actions">
          <span className={`preprocess-operation-status is-${operation.status}`}>
            {preprocessStatusLabels[operation.status] ?? operation.status}
          </span>
          <Button icon={<ArrowLeft size={13} />} onClick={onBack}>
            返回改动预览
          </Button>
        </div>
      </header>

      <div className="preprocess-operation-detail__body">
        <section className="preprocess-operation-progress-card" aria-label="任务进度">
          <div className="preprocess-operation-progress-card__heading">
            <div>
              <span>{preprocessStageLabel(operation)}</span>
              <strong>{progress.determinate ? `${progress.percent}%` : "处理中"}</strong>
            </div>
            <small>{preprocessProgressCountLabel(operation, true)}</small>
          </div>
          <div
            className={`preprocess-progress-track ${
              active && (!progress.determinate || progress.completed === 0)
                ? "is-indeterminate"
                : ""
            }`}
            role="progressbar"
            aria-label="预处理进度"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={progress.determinate ? progress.percent : undefined}
          >
            <span style={{ width: `${progress.percent}%` }} />
          </div>
          <div className="preprocess-operation-timing">
            <span>
              <Clock3 size={14} />
              已用时 {formatDurationSeconds(elapsed)}
            </span>
            {active ? (
              <strong>
                {etaSeconds !== null
                  ? `预计剩余 ${formatDurationSeconds(etaSeconds)}`
                  : !progress.determinate
                    ? "重启后端后可显示实时 ETA"
                    : progress.completed === progress.total && progress.total > 0
                      ? "正在完成索引更新"
                      : "完成首项后估算剩余时间"}
              </strong>
            ) : runtime ? (
              <strong>实际处理耗时 {formatDurationMilliseconds(runtime.duration_ms)}</strong>
            ) : null}
          </div>
          {active && operation.current_relative_path ? (
            <p title={operation.current_relative_path}>
              当前已写入：{operation.current_relative_path}
            </p>
          ) : null}
        </section>

        <div className="preprocess-operation-detail__grid">
          <section>
            <header>
              <ImageIcon size={15} />
              <h3>处理内容</h3>
            </header>
            {optionDetails.map((detail) => (
              <p key={detail}>{detail}</p>
            ))}
          </section>
          <section>
            <header>
              <Cpu size={15} />
              <h3>执行配置</h3>
            </header>
            <p>{executionModeLabels[operation.execution.mode]}</p>
            <p>
              CPU{" "}
              {operation.execution.max_workers
                ? `${operation.execution.max_workers} 线程`
                : "自动线程"}
              {" · "}批大小{" "}
              {operation.execution.batch_size ? operation.execution.batch_size : "自动"}
            </p>
            {operation.execution.accelerator_id ? (
              <p title={operation.execution.accelerator_id}>
                加速器：{operation.execution.accelerator_id}
              </p>
            ) : null}
          </section>
          {runtime ? (
            <section>
              <header>
                <Gauge size={15} />
                <h3>实际执行路线</h3>
              </header>
              <p>
                {runtime.backend_label} · CPU {runtime.worker_count} 线程 · 批大小{" "}
                {runtime.batch_size}
              </p>
              <p>
                {runtime.route_counts.accelerated_full ?? 0} 加速管线 ·{" "}
                {runtime.route_counts.accelerated_resize ?? 0} 加速缩放 ·{" "}
                {runtime.route_counts.cpu ?? 0} CPU
              </p>
              {routeReasonCount ? <p>能力或策略选择 CPU：{routeReasonCount} 项</p> : null}
              {fallbackCount ? <p>加速运行时回退：{fallbackCount} 项</p> : null}
            </section>
          ) : null}
        </div>

        <footer>
          <span>任务 ID：{operation.id}</span>
          <span>创建于 {new Date(operation.created_at).toLocaleString()}</span>
        </footer>
        {operation.error_message ? (
          <p className="form-error preprocess-operation-detail__error">{operation.error_message}</p>
        ) : null}
      </div>
    </section>
  );
}
