import {
  ArchiveRestore,
  CircleAlert,
  FileJson,
  FileText,
  Image,
  RotateCcw,
  Trash2,
  X,
} from "lucide-react";

import { useAssetDeletionDialogController } from "../../../../src/application/workspace/useAssetDeletionDialogController";
import { legacyConfirm } from "../../../legacy/legacyInteractions";
import type { AssetDeleteOperation } from "../../../../src/shared/api/types";
import { Button } from "../../../shared/ui/Button";
import { ModalLayer } from "../../../shared/ui/ModalLayer";
import { Spinner } from "../../../shared/ui/Spinner";

interface AssetDeletionDialogProps {
  projectId: string;
  open: boolean;
  assetIds: string[];
  initialView: "preview" | "history";
  onClose: () => void;
  beforeExecute: (assetIds: string[]) => Promise<boolean>;
  onDeleted: (assetIds: string[]) => void;
}

const STATUS_LABELS: Record<AssetDeleteOperation["status"], string> = {
  running: "删除中",
  completed: "可恢复",
  undoing: "恢复中",
  undone: "已恢复",
  failed: "失败",
  recovering: "自动恢复中",
  recovery_required: "需要恢复",
};

export function AssetDeletionDialog({
  projectId,
  open,
  assetIds,
  initialView,
  onClose,
  beforeExecute,
  onDeleted,
}: AssetDeletionDialogProps) {
  const controller = useAssetDeletionDialogController({
    projectId,
    open,
    assetIds,
    initialView,
    onClose,
    beforeExecute,
    onDeleted,
    confirm: legacyConfirm,
  });
  const {
    view,
    setView,
    operations,
    preview,
    previewPending,
    previewError,
    executePending,
    undoPending,
    busy,
    canExecute,
    error: actionError,
    notice,
    execute,
    undo,
    close,
  } = controller;

  if (!open) return null;

  return (
    <ModalLayer
      open={open}
      onClose={close}
      backdropClassName="asset-deletion-backdrop"
      panelClassName="asset-deletion-dialog"
      labelledBy="asset-deletion-title"
      initialFocusSelector="[data-asset-deletion-close]"
    >
      <header>
        <div>
          <span className="eyebrow">Recoverable deletion</span>
          <h2 id="asset-deletion-title">素材删除与恢复</h2>
        </div>
        <button
          type="button"
          data-asset-deletion-close=""
          aria-label="关闭"
          disabled={busy}
          onClick={close}
        >
          <X size={17} />
        </button>
      </header>

      <nav aria-label="素材删除面板">
        {assetIds.length ? (
          <button
            type="button"
            className={view === "preview" ? "is-active" : ""}
            onClick={() => setView("preview")}
          >
            删除预览
          </button>
        ) : null}
        <button
          type="button"
          className={view === "history" ? "is-active" : ""}
          onClick={() => setView("history")}
        >
          恢复记录
        </button>
      </nav>

      <div className="asset-deletion-dialog__body">
        {view === "preview" ? (
          previewPending ? (
            <div className="asset-deletion-dialog__empty">
              <Spinner label="核对文件范围" />
              <p>正在校验图片和旁车文件…</p>
            </div>
          ) : previewError ? (
            <div className="asset-deletion-dialog__empty is-error">
              <CircleAlert size={22} />
              <p>{previewError instanceof Error ? previewError.message : "无法生成删除预览。"}</p>
            </div>
          ) : preview ? (
            <>
              <p className="asset-deletion-dialog__lead">
                即将处理 <strong>{preview.asset_count}</strong> 张图片。文件会先移入
                <code>.annotation-workspace/recovery</code>，可从恢复记录撤销；不会删除空目录。
              </p>
              <div className="asset-deletion-summary">
                <article>
                  <Image size={16} />
                  <strong>{preview.image_count}</strong>
                  <span>图片</span>
                </article>
                <article>
                  <FileText size={16} />
                  <strong>{preview.annotation_count}</strong>
                  <span>标注</span>
                </article>
                <article>
                  <ArchiveRestore size={16} />
                  <strong>{preview.translation_count}</strong>
                  <span>译文</span>
                </article>
                <article>
                  <FileJson size={16} />
                  <strong>{preview.metadata_count}</strong>
                  <span>JSON</span>
                </article>
              </div>
              {preview.warnings.map((warning) => (
                <p className="asset-deletion-message is-warning" key={warning}>
                  <CircleAlert size={14} />
                  {warning}
                </p>
              ))}
              {preview.blocking_issues.map((issue) => (
                <p className="asset-deletion-message is-error" key={issue}>
                  <CircleAlert size={14} />
                  {issue}
                </p>
              ))}
            </>
          ) : null
        ) : operations.isLoading ? (
          <div className="asset-deletion-dialog__empty">
            <Spinner label="读取恢复记录" />
          </div>
        ) : operations.data?.length ? (
          <div className="asset-deletion-history">
            {operations.data.map((operation) => (
              <article key={operation.id}>
                <header>
                  <div>
                    <strong>{operation.asset_count} 张图片</strong>
                    <small>{new Date(operation.created_at).toLocaleString()}</small>
                  </div>
                  <span className={`is-${operation.status}`}>
                    {STATUS_LABELS[operation.status]}
                  </span>
                </header>
                <p>
                  共 {operation.file_count} 个文件 · 标注 {operation.annotation_count} · 译文{" "}
                  {operation.translation_count} · JSON {operation.metadata_count}
                </p>
                {operation.shared_sidecar_count ? (
                  <small>{operation.shared_sidecar_count} 个共享旁车已保留</small>
                ) : null}
                {operation.error_message ? (
                  <p className="asset-deletion-message is-error">{operation.error_message}</p>
                ) : null}
                {operation.status === "completed" ? (
                  <Button
                    icon={undoPending ? <Spinner /> : <RotateCcw size={13} />}
                    disabled={busy}
                    onClick={() => void undo(operation)}
                  >
                    恢复这次删除
                  </Button>
                ) : null}
              </article>
            ))}
          </div>
        ) : (
          <div className="asset-deletion-dialog__empty">
            <ArchiveRestore size={23} />
            <p>当前还没有素材删除记录。</p>
          </div>
        )}
      </div>

      {notice ? <p className="asset-deletion-dialog__notice">{notice}</p> : null}
      {actionError ? (
        <p className="asset-deletion-message is-error">
          <CircleAlert size={14} />
          {actionError}
        </p>
      ) : null}

      <footer>
        <Button disabled={busy} onClick={close}>
          关闭
        </Button>
        {view === "preview" ? (
          <Button
            tone="danger"
            icon={executePending ? <Spinner /> : <Trash2 size={14} />}
            disabled={!canExecute}
            onClick={() => void execute()}
          >
            移入恢复区
          </Button>
        ) : null}
      </footer>
    </ModalLayer>
  );
}
