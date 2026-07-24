import { useEffect, useMemo, useState } from "react";
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

import {
  useAssetDeletionActions,
  useAssetDeletionOperations,
} from "../../../features/assetDeletions/hooks";
import type { AssetDeleteOperation } from "../../../shared/api/types";
import { Button } from "../../../shared/ui/Button";
import { confirmDialog } from "../../../shared/ui/dialogs";
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
  const [view, setView] = useState(initialView);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const operations = useAssetDeletionOperations(projectId, open);
  const actions = useAssetDeletionActions(projectId);
  const { mutate: previewDeletion, reset: resetPreview } = actions.preview;
  const assetIdsKey = useMemo(() => assetIds.join("\u0000"), [assetIds]);
  const busy = actions.execute.isPending || actions.undo.isPending;

  useEffect(() => {
    if (!open) return;
    setView(initialView);
    setActionError(null);
    setNotice(null);
    resetPreview();
    if (initialView === "preview" && assetIds.length) previewDeletion(assetIds);
  }, [assetIds, assetIdsKey, initialView, open, previewDeletion, resetPreview]);

  if (!open) return null;

  const preview = actions.preview.data;
  const canExecute =
    Boolean(preview) && !preview?.blocking_issues.length && !actions.preview.isPending && !busy;

  async function executeDeletion() {
    if (!preview || !(await beforeExecute(assetIds))) return;
    setActionError(null);
    setNotice(null);
    try {
      await actions.execute.mutateAsync({
        assetIds,
        previewToken: preview.preview_token,
      });
      onDeleted(assetIds);
      setNotice(`已将 ${assetIds.length} 张图片及可独占旁车移入项目恢复区。`);
      setView("history");
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : "删除素材失败。");
    }
  }

  async function undo(operation: AssetDeleteOperation) {
    const confirmed = await confirmDialog(
      `恢复这次删除的 ${operation.asset_count} 张图片及其旁车文件？`,
      {
        title: "恢复已删除素材",
        confirmLabel: "恢复",
      },
    );
    if (!confirmed) return;
    setActionError(null);
    setNotice(null);
    try {
      await actions.undo.mutateAsync(operation.id);
      setNotice(`已恢复 ${operation.asset_count} 张图片。`);
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : "恢复素材失败。");
    }
  }

  function close() {
    if (!busy) onClose();
  }

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
          actions.preview.isPending ? (
            <div className="asset-deletion-dialog__empty">
              <Spinner label="核对文件范围" />
              <p>正在校验图片和旁车文件…</p>
            </div>
          ) : actions.preview.isError ? (
            <div className="asset-deletion-dialog__empty is-error">
              <CircleAlert size={22} />
              <p>
                {actions.preview.error instanceof Error
                  ? actions.preview.error.message
                  : "无法生成删除预览。"}
              </p>
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
                    icon={actions.undo.isPending ? <Spinner /> : <RotateCcw size={13} />}
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
            icon={actions.execute.isPending ? <Spinner /> : <Trash2 size={14} />}
            disabled={!canExecute}
            onClick={() => void executeDeletion()}
          >
            移入恢复区
          </Button>
        ) : null}
      </footer>
    </ModalLayer>
  );
}
