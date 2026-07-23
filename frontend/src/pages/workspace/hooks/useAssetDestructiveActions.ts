import { useCallback, useEffect, useState } from "react";

import { useDeleteAnnotations } from "../../../features/annotations/hooks";
import { useAppStore } from "../../../shared/store/appStore";
import { alertDialog, confirmDialog } from "../../../shared/ui/dialogs";

interface UseAssetDestructiveActionsOptions {
  projectId: string;
  contextKey: string;
  selectedAssetId: string | null;
  editorDirty: boolean;
  discardEditorDraft: () => void;
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

export function useAssetDestructiveActions({
  projectId,
  contextKey,
  selectedAssetId,
  editorDirty,
  discardEditorDraft,
}: UseAssetDestructiveActionsOptions) {
  const selectAsset = useAppStore((state) => state.selectAsset);
  const setAssetsChecked = useAppStore((state) => state.setAssetsChecked);
  const deleteAnnotations = useDeleteAnnotations(projectId);
  const [deletionDialog, setDeletionDialog] = useState<AssetDeletionDialogState>(CLOSED_DIALOG);

  useEffect(() => {
    setDeletionDialog(CLOSED_DIALOG);
  }, [contextKey]);

  const beforeDeleteAssets = useCallback(
    async (assetIds: string[]): Promise<boolean> => {
      if (!editorDirty || !selectedAssetId || !assetIds.includes(selectedAssetId)) return true;
      return confirmDialog(
        "当前图片的标注尚未保存。删除这张素材会丢弃编辑器中的修改，仍要继续吗？",
        {
          title: "未保存的标注",
          tone: "danger",
          confirmLabel: "丢弃并删除",
          cancelLabel: "继续编辑",
        },
      );
    },
    [editorDirty, selectedAssetId],
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

  const deleteCheckedAnnotations = useCallback(async () => {
    const assetIds = [...useAppStore.getState().checkedAssetIds];
    if (!assetIds.length) return;
    const discardsDraft = Boolean(
      editorDirty && selectedAssetId && assetIds.includes(selectedAssetId),
    );
    const confirmed = await confirmDialog(
      `删除所选 ${assetIds.length} 张图片的同名标注文件？内部版本历史仍会保留。${
        discardsDraft ? " 当前编辑器中的未保存修改也会丢失。" : ""
      }`,
      {
        title: "批量删除标注",
        tone: "danger",
        confirmLabel: "删除标注",
      },
    );
    if (!confirmed) return;
    try {
      const result = await deleteAnnotations.mutateAsync(assetIds);
      if (discardsDraft) discardEditorDraft();
      await alertDialog(
        `已删除 ${result.deleted_count} 份标注；${result.missing_count} 张图片原本没有标注。`,
        { title: "批量删除完成" },
      );
    } catch (error) {
      await alertDialog(error instanceof Error ? error.message : "批量删除标注失败。", {
        title: "删除标注失败",
      });
    }
  }, [deleteAnnotations, discardEditorDraft, editorDirty, selectedAssetId]);

  const openCheckedAssetDeletion = useCallback(() => {
    const assetIds = [...useAppStore.getState().checkedAssetIds];
    if (!assetIds.length) return;
    setDeletionDialog({ open: true, assetIds, initialView: "preview" });
  }, []);

  const openAssetDeletion = useCallback((assetId: string) => {
    setDeletionDialog({
      open: true,
      assetIds: [assetId],
      initialView: "preview",
    });
  }, []);

  const openDeletionHistory = useCallback(() => {
    setDeletionDialog({ open: true, assetIds: [], initialView: "history" });
  }, []);

  const closeDeletionDialog = useCallback(() => {
    setDeletionDialog((current) => ({ ...current, open: false }));
  }, []);

  return {
    deletionDialog,
    annotationDeletePending: deleteAnnotations.isPending,
    beforeDeleteAssets,
    handleAssetsDeleted,
    deleteCheckedAnnotations,
    openCheckedAssetDeletion,
    openAssetDeletion,
    openDeletionHistory,
    closeDeletionDialog,
  };
}
