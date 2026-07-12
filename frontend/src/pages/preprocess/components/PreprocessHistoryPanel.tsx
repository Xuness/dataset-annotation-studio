import { ArchiveRestore, RotateCcw } from "lucide-react";

import type { PreprocessOperation } from "../../../shared/api/types";
import { Button } from "../../../shared/ui/Button";
import { Spinner } from "../../../shared/ui/Spinner";

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
    <aside className="preprocess-history">
      <header>
        <ArchiveRestore size={16} />
        <div>
          <span className="eyebrow">Project recovery</span>
          <h2>项目恢复记录</h2>
        </div>
      </header>
      <p>原图保存在当前项目内部，跟随整个文件夹移动，并且不会出现在素材列表。</p>
      <div>
        {operations.map((operation) => (
          <article key={operation.id}>
            <header>
              <strong>{operation.item_count} 张图片</strong>
              <span>
                {operation.status === "completed"
                  ? "可撤销"
                  : operation.status === "undone"
                    ? "已撤销"
                    : operation.status}
              </span>
            </header>
            <small>{new Date(operation.created_at).toLocaleString()}</small>
            <p>
              {operation.options.resize ? `最长边 ${operation.options.resize.max_edge}` : "不缩放"}
              {operation.options.convert
                ? ` · ${operation.options.convert.format.toUpperCase()}`
                : ""}
            </p>
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
        ))}
      </div>
    </aside>
  );
}
