import type { CSSProperties } from "react";

import type {
  PreparationOperationSummary,
  PreparationSpaceContent,
} from "../../../../pages/spaces/spacePageModel";

interface PreparationOperationStripProps {
  content: PreparationSpaceContent;
}

interface ProgressStyle extends CSSProperties {
  "--dial-archive-preparation-progress": string;
}

function formatTime(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function formatEta(seconds: number | null): string {
  if (seconds == null) return "—";
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.floor(seconds % 60);
  return `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}

function capabilityCode(operation: PreparationOperationSummary): string {
  const labels = { geometry: "GEO", encoding: "ENC", identity: "IDN" } as const;
  return operation.capabilities.map((capability) => labels[capability]).join(" + ") || "NO MODULE";
}

export function PreparationOperationStrip({ content }: PreparationOperationStripProps) {
  const operation = content.activeOperation ?? content.recentOperation;
  const recoverable = content.recoverableOperation;
  return (
    <section className="dial-archive-preparation-operations" aria-labelledby="operation-title">
      <div className="dial-archive-space-frame">
        <header className="dial-archive-preparation-section-head">
          <div>
            <span>PRP / 03 — OPERATION SIGNAL</span>
            <h2 id="operation-title">{content.activeOperation ? "当前任务" : "最近任务"}</h2>
          </div>
          <p>二级页只保留一条最高优先级记录；完整参数、拓扑与恢复校验位于任务画布。</p>
        </header>

        {operation ? (
          <div className={`dial-archive-preparation-operation is-${operation.status}`}>
            <div className="dial-archive-preparation-operation__identity">
              <span>OPERATION //</span>
              <b>{operation.id}</b>
              <em>{operation.statusLabel}</em>
            </div>
            <div className="dial-archive-preparation-operation__signal">
              <div
                className="dial-archive-preparation-operation__track"
                role="progressbar"
                aria-label="整备任务总体进度"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={operation.determinate ? operation.progressPercent : undefined}
                style={
                  {
                    "--dial-archive-preparation-progress": `${operation.progressPercent}%`,
                  } as ProgressStyle
                }
              >
                <i />
              </div>
              <div className="dial-archive-preparation-operation__readout">
                <span>
                  PASS <b>{operation.progressPercent}%</b>
                </span>
                <span>
                  DONE <b>{operation.completedItems}</b> / {operation.itemCount}
                </span>
                <span>
                  ETA <b>{formatEta(operation.etaSeconds)}</b>
                </span>
              </div>
              <p>{operation.stageLabel}</p>
            </div>
            <dl className="dial-archive-preparation-operation__facts">
              <div>
                <dt>MODULES</dt>
                <dd>{capabilityCode(operation)}</dd>
              </div>
              <div>
                <dt>BACKEND</dt>
                <dd>{operation.backendLabel}</dd>
              </div>
              <div>
                <dt>TIME</dt>
                <dd>{formatTime(operation.completedAt ?? operation.createdAt)}</dd>
              </div>
              <div>
                <dt>CURRENT</dt>
                <dd>{operation.currentRelativePath ?? "—"}</dd>
              </div>
            </dl>
            <button type="button" onClick={() => content.openOperation(operation.id, "commit")}>
              <b>{content.activeOperation ? "观察任务" : "打开任务记录"}</b>
              <em>OPEN CANVAS →</em>
            </button>
          </div>
        ) : (
          <div className="dial-archive-preparation-operation-empty">
            <span>OPERATION // NONE</span>
            <h3>还没有整备任务</h3>
            <p>从上方任一能力入口进入任务画布，配置同一项可预演、可恢复的整备任务。</p>
            <button
              type="button"
              disabled={!content.project || content.status !== "ready"}
              onClick={() => content.openWorkbench()}
            >
              创建任务 →
            </button>
          </div>
        )}

        {recoverable ? (
          <button
            className="dial-archive-preparation-recovery-entry"
            type="button"
            onClick={() => content.openOperation(recoverable.id, "recovery")}
          >
            <span>LATEST RECOVERABLE //</span>
            <b>{recoverable.id}</b>
            <em>追溯与恢复 →</em>
          </button>
        ) : null}
      </div>
    </section>
  );
}
