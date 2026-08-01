import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { usePreviewTagBatchEdit, useExecuteTagBatchEdit } from "../../features/annotations/hooks";
import { thumbnailUrl } from "../../features/assets/api";
import { useTagFrequency } from "../../features/statistics/hooks";
import { useTagDictionarySearch } from "../../features/tagDictionaries/hooks";
import { useTaggerLibrary, useTaggerVocabularySearch } from "../../features/taggers/hooks";
import type {
  AnnotationTagBatchDetailFilter,
  AnnotationTagBatchEditPreview,
  AnnotationTagBatchEditResult,
} from "../../shared/api/types";
import { actionError } from "../interaction";
import {
  makeTagBatchRequest,
  normalizeBatchTagKey,
  type TagBatchEditMode,
  type TagBatchInsertPositionKind,
} from "./tagBatchEditState";

const PREVIEW_DETAIL_LIMIT = 20;

export type TagBatchSuggestionField = "add" | "source" | "replacement";

export interface TagBatchSuggestion {
  name: string;
  category: string | null;
  translation: string | null;
}

interface UseTagBatchEditControllerOptions {
  projectId: string;
  open: boolean;
  assetIds: readonly string[];
  blockedTagDraft: boolean;
  onClose: () => void;
}

function isChinese(value: string): boolean {
  return /\p{Script=Han}/u.test(value);
}

export function useTagBatchEditController({
  projectId,
  open,
  assetIds,
  blockedTagDraft,
  onClose,
}: UseTagBatchEditControllerOptions) {
  const assetIdsKey = assetIds.join("\u0000");
  const requestVersionRef = useRef(0);
  const [mode, setMode] = useState<TagBatchEditMode>("add");
  const [addDraft, setAddDraft] = useState("");
  const [removeDraft, setRemoveDraft] = useState("");
  const [sourceDraft, setSourceDraft] = useState("");
  const [replacementDraft, setReplacementDraft] = useState("");
  const [insertPositionKind, setInsertPositionKind] = useState<TagBatchInsertPositionKind>("end");
  const [insertIndexDraft, setInsertIndexDraft] = useState("1");
  const [insertAnchorDraft, setInsertAnchorDraft] = useState("");
  const [anchorSuggestionsOpen, setAnchorSuggestionsOpen] = useState(false);
  const [replacementCategory, setReplacementCategory] = useState<string | null>(null);
  const [categoryByName, setCategoryByName] = useState<Map<string, string | null>>(new Map());
  const [suggestionField, setSuggestionField] = useState<TagBatchSuggestionField>("add");
  const [preview, setPreview] = useState<AnnotationTagBatchEditPreview | null>(null);
  const [result, setResult] = useState<AnnotationTagBatchEditResult | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [detailRetry, setDetailRetry] = useState<{
    filter: AnnotationTagBatchDetailFilter;
    offset: number;
  } | null>(null);

  const previewMutation = usePreviewTagBatchEdit(projectId);
  const executeMutation = useExecuteTagBatchEdit(projectId);
  const resetPreviewMutation = previewMutation.reset;
  const resetExecuteMutation = executeMutation.reset;
  const library = useTaggerLibrary(open);
  const tagFrequency = useTagFrequency(projectId);
  const readyInstallations = useMemo(
    () => library.data?.installations.filter((item) => item.status === "ready") ?? [],
    [library.data?.installations],
  );
  const suggestionInstallation = readyInstallations[0] ?? null;
  const suggestionDraft =
    mode === "add"
      ? addDraft
      : mode === "replace"
        ? suggestionField === "source"
          ? sourceDraft
          : replacementDraft
        : "";
  const suggestionQuery =
    suggestionDraft.includes(",") || /[\r\n]/u.test(suggestionDraft) ? "" : suggestionDraft.trim();
  const [debouncedSuggestionQuery, setDebouncedSuggestionQuery] = useState("");

  useEffect(() => {
    const timer = window.setTimeout(
      () => setDebouncedSuggestionQuery(suggestionQuery),
      suggestionQuery ? 180 : 0,
    );
    return () => window.clearTimeout(timer);
  }, [suggestionQuery]);

  const chineseQuery = isChinese(debouncedSuggestionQuery);
  const vocabulary = useTaggerVocabularySearch(
    open && !chineseQuery ? (suggestionInstallation?.id ?? null) : null,
    suggestionInstallation?.fingerprint ?? "",
    open && !chineseQuery ? debouncedSuggestionQuery : "",
  );
  const dictionary = useTagDictionarySearch(
    open && chineseQuery ? debouncedSuggestionQuery : "",
    "zh-CN",
  );
  const suggestions = useMemo<TagBatchSuggestion[]>(() => {
    if (!debouncedSuggestionQuery) return [];
    if (chineseQuery) {
      return (
        dictionary.data?.items.slice(0, 8).map((item) => ({
          name: item.tag,
          category: item.category,
          translation: item.effective_translation,
        })) ?? []
      );
    }
    return (
      vocabulary.data?.items.slice(0, 8).map((item) => ({
        name: item.name,
        category: item.category,
        translation: null,
      })) ?? []
    );
  }, [chineseQuery, debouncedSuggestionQuery, dictionary.data?.items, vocabulary.data?.items]);
  const suggestionsLoading =
    Boolean(debouncedSuggestionQuery) &&
    (chineseQuery ? dictionary.isFetching : vocabulary.isFetching);
  const suggestionVisible = mode !== "remove" && Boolean(suggestionQuery) && suggestions.length > 0;
  const anchorSuggestions = useMemo(() => {
    const query = normalizeBatchTagKey(insertAnchorDraft);
    return (tagFrequency.data?.buckets ?? [])
      .filter((item) => !query || normalizeBatchTagKey(item.value).includes(query))
      .slice(0, 8);
  }, [insertAnchorDraft, tagFrequency.data?.buckets]);

  const requestState = useMemo(
    () =>
      makeTagBatchRequest(
        [...assetIds],
        mode,
        addDraft,
        removeDraft,
        sourceDraft,
        replacementDraft,
        {
          kind: insertPositionKind,
          indexDraft: insertIndexDraft,
          anchorDraft: insertAnchorDraft,
        },
        categoryByName,
        replacementCategory,
      ),
    [
      addDraft,
      assetIds,
      categoryByName,
      insertAnchorDraft,
      insertIndexDraft,
      insertPositionKind,
      mode,
      removeDraft,
      replacementCategory,
      replacementDraft,
      sourceDraft,
    ],
  );
  const inputPresent = Boolean(
    mode === "add"
      ? addDraft.trim()
      : mode === "remove"
        ? removeDraft.trim()
        : sourceDraft.trim() || replacementDraft.trim(),
  );
  const busy = previewMutation.isPending || executeMutation.isPending;
  const previewHasChanges = Boolean(preview && preview.changed_count > 0);

  const resetTransientState = useCallback(() => {
    requestVersionRef.current += 1;
    setPreview(null);
    setNotice(null);
    setError(null);
    setDetailError(null);
    setDetailRetry(null);
    resetPreviewMutation();
    resetExecuteMutation();
  }, [resetExecuteMutation, resetPreviewMutation]);

  useEffect(() => {
    if (!open) {
      requestVersionRef.current += 1;
      return;
    }
    requestVersionRef.current += 1;
    setMode("add");
    setAddDraft("");
    setRemoveDraft("");
    setSourceDraft("");
    setReplacementDraft("");
    setInsertPositionKind("end");
    setInsertIndexDraft("1");
    setInsertAnchorDraft("");
    setAnchorSuggestionsOpen(false);
    setReplacementCategory(null);
    setCategoryByName(new Map());
    setSuggestionField("add");
    setPreview(null);
    setResult(null);
    setNotice(null);
    setError(null);
    setDetailError(null);
    setDetailRetry(null);
    resetPreviewMutation();
    resetExecuteMutation();
  }, [assetIdsKey, open, resetExecuteMutation, resetPreviewMutation]);

  useEffect(
    () => () => {
      requestVersionRef.current += 1;
    },
    [],
  );

  function updateDraft(setter: (value: string) => void, value: string) {
    setter(value);
    resetTransientState();
    setResult(null);
  }

  function updateAddDraft(value: string) {
    updateDraft(setAddDraft, value);
  }

  function updateRemoveDraft(value: string) {
    updateDraft(setRemoveDraft, value);
  }

  function updateSourceDraft(value: string) {
    updateDraft(setSourceDraft, value);
  }

  function updateReplacementDraft(value: string) {
    setReplacementCategory(null);
    updateDraft(setReplacementDraft, value);
  }

  function updateInsertIndex(value: string) {
    updateDraft(setInsertIndexDraft, value);
  }

  function updateInsertAnchor(value: string) {
    updateDraft(setInsertAnchorDraft, value);
    setAnchorSuggestionsOpen(true);
  }

  function selectMode(value: TagBatchEditMode) {
    setMode(value);
    setSuggestionField(value === "replace" ? "source" : "add");
    resetTransientState();
    setResult(null);
  }

  function updateInsertPositionKind(value: TagBatchInsertPositionKind) {
    setInsertPositionKind(value);
    resetTransientState();
    setResult(null);
    setAnchorSuggestionsOpen(value === "before" || value === "after");
  }

  function selectSuggestion(item: TagBatchSuggestion) {
    const key = normalizeBatchTagKey(item.name);
    if (mode === "add") {
      updateAddDraft(addDraft ? `${addDraft}, ${item.name}` : item.name);
      setCategoryByName((current) => new Map(current).set(key, item.category));
    } else if (suggestionField === "source") {
      updateSourceDraft(item.name);
    } else {
      updateReplacementDraft(item.name);
      setReplacementCategory(item.category);
    }
    setDebouncedSuggestionQuery("");
  }

  function selectAnchorSuggestion(name: string) {
    updateDraft(setInsertAnchorDraft, name);
    setAnchorSuggestionsOpen(false);
  }

  async function previewChanges() {
    if (!requestState.request || requestState.error) return;
    const requestVersion = ++requestVersionRef.current;
    setError(null);
    setNotice(null);
    setResult(null);
    setDetailError(null);
    setDetailRetry(null);
    try {
      const nextPreview = await previewMutation.mutateAsync({
        request: requestState.request,
        options: {
          detailFilter: "changed",
          detailOffset: 0,
          detailLimit: PREVIEW_DETAIL_LIMIT,
        },
      });
      if (requestVersion !== requestVersionRef.current) return;
      setPreview(nextPreview);
    } catch (reason) {
      if (requestVersion !== requestVersionRef.current) return;
      setPreview(null);
      setError(actionError(reason, "批量 Tags 预览失败，请重试。"));
    }
  }

  async function loadPreviewDetails(
    detailFilter: AnnotationTagBatchDetailFilter,
    detailOffset: number,
  ) {
    if (!requestState.request || !preview) return;
    const requestVersion = ++requestVersionRef.current;
    setDetailError(null);
    setDetailRetry(null);
    try {
      const nextPreview = await previewMutation.mutateAsync({
        request: requestState.request,
        options: {
          detailFilter,
          detailOffset,
          detailLimit: PREVIEW_DETAIL_LIMIT,
        },
      });
      if (requestVersion !== requestVersionRef.current) return;
      setPreview(nextPreview);
    } catch (reason) {
      if (requestVersion !== requestVersionRef.current) return;
      setDetailError(actionError(reason, "实际 Tags 顺序读取失败，请重试。"));
      setDetailRetry({ filter: detailFilter, offset: detailOffset });
    }
  }

  function retryPreviewDetails() {
    if (!preview) return;
    void loadPreviewDetails(
      detailRetry?.filter ?? preview.details.filter,
      detailRetry?.offset ?? preview.details.offset,
    );
  }

  async function executeChanges() {
    if (!requestState.request || !preview || !previewHasChanges || blockedTagDraft) return;
    const requestVersion = ++requestVersionRef.current;
    setError(null);
    setNotice(null);
    try {
      const nextResult = await executeMutation.mutateAsync({
        ...requestState.request,
        preview_token: preview.preview_token,
      });
      if (requestVersion !== requestVersionRef.current) return;
      setResult(nextResult);
      setPreview(null);
      setDetailError(null);
      setDetailRetry(null);
      setAddDraft("");
      setRemoveDraft("");
      setSourceDraft("");
      setReplacementDraft("");
      setInsertPositionKind("end");
      setInsertIndexDraft("1");
      setInsertAnchorDraft("");
      setAnchorSuggestionsOpen(false);
      setReplacementCategory(null);
      setCategoryByName(new Map());
      setNotice(`已更新 ${nextResult.changed_count} 张图片的 Tags；素材勾选范围保持不变。`);
    } catch (reason) {
      if (requestVersion !== requestVersionRef.current) return;
      setError(actionError(reason, "批量 Tags 执行失败，请重新预览后重试。"));
      setPreview(null);
    }
  }

  function close() {
    if (busy) return;
    requestVersionRef.current += 1;
    onClose();
  }

  const modeDescription =
    mode === "add"
      ? insertPositionKind === "end"
        ? "添加到列表末尾；已存在项会跳过。"
        : insertPositionKind === "start"
          ? "添加到列表开头；已存在项会跳过。"
          : insertPositionKind === "index"
            ? "按每张图片自己的 Tags 列表插入；已存在项会跳过。"
            : "按精确锚点插入；找不到锚点的图片会跳过。"
      : mode === "remove"
        ? "只删除精确命中的 Tags；其余顺序保持不变。"
        : "只处理包含来源 Tag 的图片；目标已存在时自动去重。";

  return {
    mode,
    addDraft,
    removeDraft,
    sourceDraft,
    replacementDraft,
    insertPositionKind,
    insertIndexDraft,
    insertAnchorDraft,
    anchorSuggestionsOpen,
    suggestionField,
    preview,
    result,
    notice,
    error,
    detailError,
    requestState,
    inputPresent,
    busy,
    previewPending: previewMutation.isPending,
    executePending: executeMutation.isPending,
    previewHasChanges,
    suggestions,
    suggestionsLoading,
    suggestionVisible,
    anchorSuggestions,
    modeDescription,
    setSuggestionField,
    setAnchorSuggestionsOpen,
    selectMode,
    updateAddDraft,
    updateRemoveDraft,
    updateSourceDraft,
    updateReplacementDraft,
    updateInsertIndex,
    updateInsertAnchor,
    updateInsertPositionKind,
    selectSuggestion,
    selectAnchorSuggestion,
    previewChanges,
    loadPreviewDetails,
    retryPreviewDetails,
    executeChanges,
    close,
    thumbnailUrlFor: (assetId: string, contentVersion: string) =>
      thumbnailUrl(projectId, assetId, contentVersion, 96),
  };
}
