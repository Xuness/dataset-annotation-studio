import { useCallback, useEffect, useState } from "react";

import { useWorkspaceSelectionStore } from "../../shared/store/workspaceSelectionStore";
import type { ConfirmInteraction } from "../interaction";

interface UseAssetDeletionControllerOptions {
  contextKey: string;
  selectedAssetId: string | null;
  editorDirty: boolean;
  discardEditorDraft: () => void;
  selectAsset: (assetId: string | null) => void;
  confirm: ConfirmInteraction;
}

interface AssetDeletionDialogState {
  open: boolean;
  assetIds: string[];
  initialView: "preview" | "history";
}

const CLOSED_DIALOG: AssetDeletionDialogState = {
  open: false,
  assetIds: [],
  initialView: "history",
};

export function useAssetDeletionController({
  contextKey,
  selectedAssetId,
  editorDirty,
  discardEditorDraft,
  selectAsset,
  confirm,
}: UseAssetDeletionControllerOptions) {
  const setAssetsChecked = useWorkspaceSelectionStore((state) => state.setAssetsChecked);
  const [deletionDialog, setDeletionDialog] = useState<AssetDeletionDialogState>(CLOSED_DIALOG);

  useEffect(() => {
    setDeletionDialog(CLOSED_DIALOG);
  }, [contextKey]);

  const beforeDeleteAssets = useCallback(
    async (assetIds: string[]): Promise<boolean> => {
      if (!editorDirty || !selectedAssetId || !assetIds.includes(selectedAssetId)) return true;
      return confirm({
        message: "当前图片的标注尚未保存。删除这张素材会丢弃编辑器中的修改，仍要继续吗？",
        title: "未保存的标注",
        tone: "danger",
        confirmLabel: "丢弃并删除",
        cancelLabel: "继续编辑",
      });
    },
    [confirm, editorDirty, selectedAssetId],
  );

  const handleAssetsDeleted = useCallback(
    (assetIds: string[]) => {
      setAssetsChecked(assetIds, false);
      if (selectedAssetId && assetIds.includes(selectedAssetId)) {
        discardEditorDraft();
        selectAsset(null);
      }
    },
    [discardEditorDraft, selectAsset, selectedAssetId, setAssetsChecked],
  );

  const openCheckedAssetDeletion = useCallback(() => {
    const assetIds = [...useWorkspaceSelectionStore.getState().checkedAssetIds];
    if (!assetIds.length) return;
    setDeletionDialog({ open: true, assetIds, initialView: "preview" });
  }, []);

  const openAssetDeletion = useCallback((assetId: string) => {
    setDeletionDialog({ open: true, assetIds: [assetId], initialView: "preview" });
  }, []);

  const openDeletionHistory = useCallback(() => {
    setDeletionDialog({ open: true, assetIds: [], initialView: "history" });
  }, []);

  const closeDeletionDialog = useCallback(() => {
    setDeletionDialog((current) => ({ ...current, open: false }));
  }, []);

  return {
    deletionDialog,
    beforeDeleteAssets,
    handleAssetsDeleted,
    openCheckedAssetDeletion,
    openAssetDeletion,
    openDeletionHistory,
    closeDeletionDialog,
  };
}
