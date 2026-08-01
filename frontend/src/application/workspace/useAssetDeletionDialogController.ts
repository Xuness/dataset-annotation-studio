import { useCallback, useEffect, useMemo, useState } from "react";

import {
  useAssetDeletionActions,
  useAssetDeletionOperations,
} from "../../features/assetDeletions/hooks";
import type { AssetDeleteOperation } from "../../shared/api/types";
import { actionError, type ConfirmInteraction } from "../interaction";

interface UseAssetDeletionDialogControllerOptions {
  projectId: string;
  open: boolean;
  assetIds: readonly string[];
  initialView: "preview" | "history";
  onClose: () => void;
  beforeExecute: (assetIds: string[]) => Promise<boolean>;
  onDeleted: (assetIds: string[]) => void;
  confirm: ConfirmInteraction;
}

export function useAssetDeletionDialogController({
  projectId,
  open,
  assetIds,
  initialView,
  onClose,
  beforeExecute,
  onDeleted,
  confirm,
}: UseAssetDeletionDialogControllerOptions) {
  const [view, setView] = useState(initialView);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const operations = useAssetDeletionOperations(projectId, open);
  const actions = useAssetDeletionActions(projectId);
  const { mutate: previewDeletion, reset: resetPreview } = actions.preview;
  const assetIdsKey = useMemo(() => assetIds.join("\u0000"), [assetIds]);
  const busy = actions.execute.isPending || actions.undo.isPending;

  useEffect(() => {
    if (!open) return;
    setView(initialView);
    setError(null);
    setNotice(null);
    resetPreview();
    if (initialView === "preview" && assetIds.length) previewDeletion([...assetIds]);
  }, [assetIds, assetIdsKey, initialView, open, previewDeletion, resetPreview]);

  const preview = actions.preview.data;
  const canExecute =
    Boolean(preview) && !preview?.blocking_issues.length && !actions.preview.isPending && !busy;

  const execute = useCallback(async () => {
    if (!preview || !(await beforeExecute([...assetIds]))) return;
    setError(null);
    setNotice(null);
    try {
      await actions.execute.mutateAsync({
        assetIds: [...assetIds],
        previewToken: preview.preview_token,
      });
      onDeleted([...assetIds]);
      setNotice(`已将 ${assetIds.length} 张图片及可独占旁车移入项目恢复区。`);
      setView("history");
    } catch (reason) {
      setError(actionError(reason, "删除素材失败。"));
    }
  }, [actions.execute, assetIds, beforeExecute, onDeleted, preview]);

  const undo = useCallback(
    async (operation: AssetDeleteOperation) => {
      const accepted = await confirm({
        message: `恢复这次删除的 ${operation.asset_count} 张图片及其旁车文件？`,
        title: "恢复已删除素材",
        confirmLabel: "恢复",
      });
      if (!accepted) return;
      setError(null);
      setNotice(null);
      try {
        await actions.undo.mutateAsync(operation.id);
        setNotice(`已恢复 ${operation.asset_count} 张图片。`);
      } catch (reason) {
        setError(actionError(reason, "恢复素材失败。"));
      }
    },
    [actions.undo, confirm],
  );

  const close = useCallback(() => {
    if (!busy) onClose();
  }, [busy, onClose]);

  return {
    view,
    setView,
    operations,
    preview,
    previewPending: actions.preview.isPending,
    previewError: actions.preview.isError ? actions.preview.error : null,
    executePending: actions.execute.isPending,
    undoPending: actions.undo.isPending,
    busy,
    canExecute,
    error,
    notice,
    execute,
    undo,
    close,
  };
}
