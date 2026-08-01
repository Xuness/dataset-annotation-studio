import { useCallback, useEffect, useMemo, useState } from "react";

import {
  useAnnotationBatchOptions,
  useDeleteAnnotations,
  useReviewAnnotations,
} from "../../features/annotations/hooks";
import type { AnnotationChannelTarget } from "../../shared/api/types";
import { actionError } from "../interaction";
import {
  annotationOptionKey,
  annotationTargetKey,
  type AnnotationBulkAction,
} from "./annotationBulk";

interface UseAnnotationBulkControllerOptions {
  projectId: string;
  open: boolean;
  action: AnnotationBulkAction;
  assetIds: readonly string[];
  blockedTarget: AnnotationChannelTarget | null;
  onClose: () => void;
}

export function useAnnotationBulkController({
  projectId,
  open,
  action,
  assetIds,
  blockedTarget,
  onClose,
}: UseAnnotationBulkControllerOptions) {
  const assetIdsKey = assetIds.join("\u0000");
  const options = useAnnotationBatchOptions(projectId, [...assetIds], open);
  const review = useReviewAnnotations(projectId);
  const remove = useDeleteAnnotations(projectId);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const busy = review.isPending || remove.isPending;
  const blockedKey = blockedTarget ? annotationTargetKey(blockedTarget) : null;

  useEffect(() => {
    if (!open) return;
    setSelectedKeys(new Set());
    setError(null);
    setNotice(null);
  }, [action, assetIdsKey, open]);

  const selectableOptions = useMemo(
    () =>
      (options.data?.targets ?? []).filter(
        (option) =>
          annotationOptionKey(option) !== blockedKey &&
          (action === "delete" || option.reviewable_count > 0),
      ),
    [action, blockedKey, options.data?.targets],
  );
  const allSelectableSelected =
    selectableOptions.length > 0 &&
    selectableOptions.every((option) => selectedKeys.has(annotationOptionKey(option)));
  const selectedOptions = (options.data?.targets ?? []).filter((option) =>
    selectedKeys.has(annotationOptionKey(option)),
  );
  const blockedOption = options.data?.targets.find(
    (option) => annotationOptionKey(option) === blockedKey,
  );

  const toggleOption = useCallback((key: string) => {
    setNotice(null);
    setSelectedKeys((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const toggleAll = useCallback(() => {
    setNotice(null);
    setSelectedKeys(
      allSelectableSelected
        ? new Set()
        : new Set(selectableOptions.map((option) => annotationOptionKey(option))),
    );
  }, [allSelectableSelected, selectableOptions]);

  const execute = useCallback(async () => {
    if (!selectedOptions.length) return;
    const targets = selectedOptions.map<AnnotationChannelTarget>((option) =>
      option.channel === "translation"
        ? {
            channel: option.channel,
            language: option.language ?? "",
            translation_source_kind: option.translation_source_kind,
            translation_producer_kind: option.translation_producer_kind,
          }
        : {
            channel: option.channel,
            language: option.language ?? "",
          },
    );
    setError(null);
    setNotice(null);
    try {
      if (action === "review") {
        const result = await review.mutateAsync({ assetIds: [...assetIds], targets });
        setNotice(
          `已复核 ${result.reviewed_count} 个标注文档；${result.already_reviewed_count} 个原本已复核，${result.blocked_count} 个内容尚不可复核，${result.missing_count} 个目标位置没有活动标注。`,
        );
      } else {
        const result = await remove.mutateAsync({ assetIds: [...assetIds], targets });
        setNotice(
          `已删除 ${result.deleted_count} 个活动标注通道；${result.missing_count} 张图片没有所选类别的活动标注。`,
        );
      }
      setSelectedKeys(new Set());
    } catch (reason) {
      setError(
        actionError(reason, action === "review" ? "批量复核标注失败。" : "批量删除标注失败。"),
      );
    }
  }, [action, assetIds, remove, review, selectedOptions]);

  const close = useCallback(() => {
    if (!busy) onClose();
  }, [busy, onClose]);

  return {
    options,
    selectedKeys,
    selectableOptions,
    selectedOptions,
    blockedKey,
    blockedOption,
    allSelectableSelected,
    busy,
    error,
    notice,
    title: action === "review" ? "选择要复核的标注" : "选择要删除的标注",
    actionLabel: action === "review" ? "标记所选类别" : "删除所选类别",
    toggleOption,
    toggleAll,
    execute,
    close,
  };
}
