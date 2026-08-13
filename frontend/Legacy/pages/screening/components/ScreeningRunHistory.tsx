import { History } from "lucide-react";

import type { ScreeningOperation } from "../../../../src/shared/api/types";

const statusLabels: Record<ScreeningOperation["status"], string> = {
  queued: "等待中",
  running: "筛选中",
  stopping: "停止中",
  stopped: "已停止",
  interrupted: "已中断",
  completed: "已完成",
  failed: "失败",
};

export function ScreeningRunHistory({
  operations,
  selectedOperationId,
  pending,
  onSelect,
}: {
  operations: ScreeningOperation[];
  selectedOperationId: string | null;
  pending: boolean;
  onSelect: (operationId: string) => void;
}) {
  return (
    <section className="screening-history">
      <header className="screening-panel-heading">
        <span className="screening-panel-icon">
          <History size={15} aria-hidden="true" />
        </span>
        <div>
          <span className="eyebrow">Run History</span>
          <h2>运行记录</h2>
        </div>
      </header>
      <div className="screening-history-list">
        {operations.map((operation) => {
          const progress = operation.total_items
            ? Math.min(100, Math.round((operation.processed_items / operation.total_items) * 100))
            : 0;
          return (
            <button
              type="button"
              key={operation.id}
              className={operation.id === selectedOperationId ? "is-selected" : ""}
              aria-pressed={operation.id === selectedOperationId}
              onClick={() => onSelect(operation.id)}
            >
              <span>
                <strong>{statusLabels[operation.status]}</strong>
                <time>{new Date(operation.created_at).toLocaleString()}</time>
              </span>
              <small>
                {operation.processed_items} / {operation.total_items} · {operation.score_version}
              </small>
              <i aria-hidden="true">
                <span style={{ width: `${progress}%` }} />
              </i>
            </button>
          );
        })}
        {!pending && !operations.length ? <p>尚未运行筛选。首次运行后会在这里保留记录。</p> : null}
        {pending && !operations.length ? <p>正在读取运行记录…</p> : null}
      </div>
    </section>
  );
}
