import { History, Undo2 } from "lucide-react";
import type { CropOperation } from "../../../src/shared/api/types";
import { Button } from "../../shared/ui/Button";

interface Props {
  operations: CropOperation[];
  busy: boolean;
  onUndo: (id: string) => void;
}
const statusLabels: Record<CropOperation["status"], string> = {
  running: "生成中",
  undoing: "撤销中",
  succeeded: "已生成",
  failed: "生成失败",
  recovery_failed: "需要恢复",
  undone: "已撤销",
};
export function CropHistory({ operations, busy, onUndo }: Props) {
  return (
    <aside
      className="crop-history"
      data-testid="crop-history"
      data-surface-region="secondary-sidebar"
    >
      <header className="crop-panel-heading">
        <History size={17} />
        <div>
          <span className="eyebrow">History</span>
          <h2>裁剪记录</h2>
        </div>
      </header>
      <p className="crop-description">
        按顺序撤销最近的图片操作，已标注或继续编辑的结果会受到保护。
      </p>
      {!operations.length && (
        <div className="crop-history-empty">
          <span>暂无裁剪记录</span>
          <p>
            生成的数量与操作状态
            <br />
            会保留在这里。
          </p>
        </div>
      )}
      {operations.map((item) => (
        <article key={item.id} className="crop-history-item">
          <div>
            <strong>{item.total} 张图片</strong>
            <span className={`crop-status crop-status--${item.status}`}>
              {item.status === "undoing" && item.error ? "撤销恢复失败" : statusLabels[item.status]}
            </span>
          </div>
          <time dateTime={item.created_at}>
            {new Date(item.created_at).toLocaleString("zh-CN", {
              month: "2-digit",
              day: "2-digit",
              hour: "2-digit",
              minute: "2-digit",
            })}
          </time>
          {item.status === "running" && (
            <progress value={item.completed} max={item.total} aria-label="裁剪进度" />
          )}
          {item.error && (
            <p className="form-error" role="alert">
              {item.error}
            </p>
          )}
          <Button
            icon={<Undo2 size={13} />}
            data-testid={`crop-undo-${item.id}`}
            disabled={busy || item.status !== "succeeded"}
            onClick={() => onUndo(item.id)}
          >
            撤销本次生成
          </Button>
        </article>
      ))}
    </aside>
  );
}
