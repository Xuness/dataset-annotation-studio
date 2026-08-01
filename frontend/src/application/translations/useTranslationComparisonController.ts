import { useCallback, useEffect, useMemo, useState } from "react";

import { useTokenCounts } from "../../features/tokenization/hooks";
import type {
  AnnotationTag,
  TagDictionaryResolution,
  TokenizationProfileId,
  TranslationDocument,
} from "../../shared/api/types";
import { buildTranslationComparisonModel, uniqueAlignmentIds } from "./translationComparison";

interface UseTranslationComparisonControllerOptions {
  translation: TranslationDocument | undefined;
  editing: boolean;
  editContent: string;
  editorTags: readonly AnnotationTag[] | undefined;
  editorTagsDirty: boolean;
  dictionaryPreview: TagDictionaryResolution | undefined;
  dictionaryPreviewLoading: boolean;
  dictionaryPreviewError: unknown;
  tokenProfileId: TokenizationProfileId;
}

export function useTranslationComparisonController(
  options: UseTranslationComparisonControllerOptions,
) {
  const model = useMemo(
    () =>
      buildTranslationComparisonModel({
        translation: options.translation,
        editing: options.editing,
        editContent: options.editContent,
        editorTags: options.editorTags,
        editorTagsDirty: options.editorTagsDirty,
        dictionaryPreview: options.dictionaryPreview,
        dictionaryPreviewLoading: options.dictionaryPreviewLoading,
        dictionaryPreviewError: options.dictionaryPreviewError,
      }),
    [
      options.dictionaryPreview,
      options.dictionaryPreviewError,
      options.dictionaryPreviewLoading,
      options.editContent,
      options.editing,
      options.editorTags,
      options.editorTagsDirty,
      options.translation,
    ],
  );
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [pinnedIds, setPinnedIds] = useState<string[]>([]);
  const activeIds = useMemo(
    () => new Set(pinnedIds.length ? pinnedIds : hoveredId ? [hoveredId] : []),
    [hoveredId, pinnedIds],
  );
  const tokenCounts = useTokenCounts(
    options.tokenProfileId,
    model.tokenCountItems,
    model.tokenCountItems.length > 0,
  );

  useEffect(() => {
    setHoveredId(null);
    setPinnedIds([]);
  }, [model.identityKey]);

  const clearPinned = useCallback(() => setPinnedIds([]), []);
  const pinIds = useCallback(
    (ids: readonly string[]) => {
      if (!model.aligned) return;
      const next = uniqueAlignmentIds(ids);
      if (!next.length) return;
      setPinnedIds(next);
      setHoveredId(null);
    },
    [model.aligned],
  );
  const setHover = useCallback(
    (id: string | null) => {
      if (!model.aligned || pinnedIds.length) return;
      setHoveredId(id);
    },
    [model.aligned, pinnedIds.length],
  );

  return {
    model,
    tokenCounts,
    hoveredId,
    pinnedIds,
    activeIds,
    clearPinned,
    pinIds,
    setHover,
  };
}
