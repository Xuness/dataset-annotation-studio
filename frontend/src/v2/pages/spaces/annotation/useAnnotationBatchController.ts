import { useMemo } from "react";

import { annotationOptionKey } from "../../../../application/annotations/annotationBulk";
import { useAnnotationBulkController } from "../../../../application/annotations/useAnnotationBulkController";
import { useTagBatchEditController } from "../../../../application/annotations/useTagBatchEditController";
import type { ConfirmInteraction } from "../../../../application/interaction";
import type { AnnotationChannelTarget } from "../../../../shared/api/types";
import type { AnnotationBatchContent } from "../spacePageModel";

interface UseAnnotationBatchControllerOptions {
  projectId: string;
  open: boolean;
  assetIds: readonly string[];
  blockedTagDraft: boolean;
  blockedTarget: AnnotationChannelTarget | null;
  confirm: ConfirmInteraction;
}

function joinTags(tags: readonly { name: string }[]): string {
  return tags.map((tag) => tag.name).join(", ");
}

export function useAnnotationBatchController({
  projectId,
  open,
  assetIds,
  blockedTagDraft,
  blockedTarget,
  confirm,
}: UseAnnotationBatchControllerOptions): AnnotationBatchContent {
  const tags = useTagBatchEditController({
    projectId,
    open,
    assetIds,
    blockedTagDraft,
    onClose: () => {},
  });
  const deletion = useAnnotationBulkController({
    projectId,
    open,
    action: "delete",
    assetIds,
    blockedTarget,
    onClose: () => {},
  });

  const deleteOptions = useMemo(
    () =>
      deletion.selectableOptions.map((option) => {
        const id = annotationOptionKey(option);
        return {
          id,
          label: option.display_name,
          activeCount: option.active_count,
          staleCount: option.stale_count,
          selected: deletion.selectedKeys.has(id),
          disabled: deletion.busy,
        };
      }),
    [deletion.busy, deletion.selectableOptions, deletion.selectedKeys],
  );
  const requestError = tags.requestState.error ?? tags.error ?? tags.detailError;

  return {
    rangeCount: assetIds.length,
    effectiveAssetIds: assetIds,
    tags: {
      mode: tags.mode,
      addDraft: tags.addDraft,
      removeDraft: tags.removeDraft,
      sourceDraft: tags.sourceDraft,
      replacementDraft: tags.replacementDraft,
      insertPosition: tags.insertPositionKind,
      insertIndex: tags.insertIndexDraft,
      insertAnchor: tags.insertAnchorDraft,
      modeDescription: tags.modeDescription,
      requestError,
      notice: tags.notice,
      busy: tags.busy,
      canPreview: Boolean(
        tags.inputPresent && !tags.requestState.error && !tags.busy && assetIds.length,
      ),
      canExecute: Boolean(tags.previewHasChanges && !tags.busy && !blockedTagDraft),
      preview: tags.preview
        ? {
            requestedCount: tags.preview.requested_count,
            changedCount: tags.preview.changed_count,
            unchangedCount: tags.preview.unchanged_count,
            positionSkippedCount: tags.preview.position_skipped_count,
            items: tags.preview.details.items.map((item) => ({
              id: item.asset_id,
              filename: item.filename,
              relativePath: item.relative_path,
              before: joinTags(item.before_tags),
              after: joinTags(item.after_tags),
              changed: item.changed,
              positionSkipped: item.position_skipped,
            })),
          }
        : null,
      setMode: tags.selectMode,
      setAddDraft: tags.updateAddDraft,
      setRemoveDraft: tags.updateRemoveDraft,
      setSourceDraft: tags.updateSourceDraft,
      setReplacementDraft: tags.updateReplacementDraft,
      setInsertPosition: tags.updateInsertPositionKind,
      setInsertIndex: tags.updateInsertIndex,
      setInsertAnchor: tags.updateInsertAnchor,
      previewChanges: tags.previewChanges,
      executeChanges: tags.executeChanges,
    },
    deletion: {
      status: !open
        ? "idle"
        : deletion.options.isPending
          ? "loading"
          : deletion.options.isError
            ? "error"
            : "ready",
      options: deleteOptions,
      selectedCount: deletion.selectedOptions.length,
      busy: deletion.busy,
      actionError:
        deletion.error ??
        (deletion.options.isError
          ? deletion.options.error instanceof Error
            ? deletion.options.error.message
            : "无法读取批量标注通道。"
          : null),
      notice: deletion.notice,
      toggle: deletion.toggleOption,
      toggleAll: deletion.toggleAll,
      execute: async () => {
        if (!deletion.selectedOptions.length || deletion.busy) return;
        const accepted = await confirm({
          title: "批量删除标注通道",
          message: `将从 ${assetIds.length} 张素材中删除 ${deletion.selectedOptions.length} 类活动标注。历史修订仍会保留。`,
          tone: "danger",
          confirmLabel: "确认删除",
          cancelLabel: "保留标注",
        });
        if (accepted) await deletion.execute();
      },
    },
  };
}
