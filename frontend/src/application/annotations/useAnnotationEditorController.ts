import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  useAnnotationBundle,
  useAnnotationChannel,
  useAnnotationChannelHistory,
  useDeleteAnnotationChannel,
  useReviewAnnotationChannel,
  useSaveAnnotationChannel,
} from "../../features/annotations/hooks";
import { useTagDictionaryResolution } from "../../features/tagDictionaries/hooks";
import { useTokenCounts } from "../../features/tokenization/hooks";
import {
  useRefreshLocalDictionaryTranslation,
  useTranslation,
  useTranslations,
} from "../../features/translations/hooks";
import type {
  AnnotationChannel,
  AnnotationChannelTarget,
  AnnotationDocument,
  AnnotationTag,
  TokenCountRequestItem,
  TokenizationProfileId,
  TranslationProducerKind,
  TranslationSourceKind,
} from "../../shared/api/types";
import { annotationTagsEqual, reconcilePersistedTags } from "../tags/tagDraft";
import { actionError, type ConfirmInteraction } from "../interaction";
import { useUnsavedScope } from "../useUnsavedScope";
import { hasExistingAnnotationDocument, reconcilePersistedContent } from "./annotationDraft";
import { annotationEditorViewState } from "./annotationEditorState";

const DEFAULT_LANGUAGES = ["zh-CN", "zh-TW", "en", "ja", "ko"];

function documentDraft(document: AnnotationDocument | undefined): string {
  return document?.content ?? "";
}

interface UseAnnotationEditorControllerOptions {
  projectId: string;
  assetId: string | null;
  tokenProfileId: TokenizationProfileId;
  confirm: ConfirmInteraction;
  onDirtyChange: (dirty: boolean, kind: "tags" | "annotation" | null) => void;
  onActiveTargetChange: (target: AnnotationChannelTarget) => void;
}

export function useAnnotationEditorController({
  projectId,
  assetId,
  tokenProfileId,
  confirm,
  onDirtyChange,
  onActiveTargetChange,
}: UseAnnotationEditorControllerOptions) {
  const { mode, language, translationSourceKind, translationProducerKind } =
    annotationEditorViewState.useValue(projectId);
  const setMode = useCallback(
    (next: AnnotationChannel) => annotationEditorViewState.patch(projectId, { mode: next }),
    [projectId],
  );
  const setLanguage = useCallback(
    (next: string) => annotationEditorViewState.patch(projectId, { language: next }),
    [projectId],
  );
  const setTranslationSourceKind = useCallback(
    (next: TranslationSourceKind) =>
      annotationEditorViewState.patch(projectId, { translationSourceKind: next }),
    [projectId],
  );
  const setTranslationProducerKind = useCallback(
    (next: TranslationProducerKind) =>
      annotationEditorViewState.patch(projectId, { translationProducerKind: next }),
    [projectId],
  );
  const [translationEditing, setTranslationEditing] = useState(false);
  const activeLanguage = mode === "translation" ? language : "";
  const bundle = useAnnotationBundle(projectId, assetId);
  const document = useAnnotationChannel(
    projectId,
    assetId,
    mode,
    activeLanguage,
    translationSourceKind,
    translationProducerKind,
  );
  const tagsDocument = useAnnotationChannel(projectId, assetId, "tags");
  const translations = useTranslations(projectId, assetId);
  const translationState = useTranslation(
    projectId,
    assetId,
    language,
    translationSourceKind,
    translationProducerKind,
  );
  const save = useSaveAnnotationChannel(
    projectId,
    assetId ?? "",
    mode,
    activeLanguage,
    translationSourceKind,
    translationProducerKind,
  );
  const saveTags = useSaveAnnotationChannel(projectId, assetId ?? "", "tags");
  const refreshLocalDictionary = useRefreshLocalDictionaryTranslation(
    projectId,
    assetId ?? "",
    language,
  );
  const review = useReviewAnnotationChannel(
    projectId,
    assetId ?? "",
    mode,
    activeLanguage,
    translationSourceKind,
    translationProducerKind,
  );
  const remove = useDeleteAnnotationChannel(
    projectId,
    assetId ?? "",
    mode,
    activeLanguage,
    translationSourceKind,
    translationProducerKind,
  );
  const [content, setContent] = useState("");
  const [savedContent, setSavedContent] = useState("");
  const [savedRevisionId, setSavedRevisionId] = useState<string | null>(null);
  const [tagDraft, setTagDraft] = useState<AnnotationTag[]>([]);
  const [savedTagDraft, setSavedTagDraft] = useState<AnnotationTag[]>([]);
  const [savedTagRevisionId, setSavedTagRevisionId] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [actionErrorMessage, setActionErrorMessage] = useState<string | null>(null);
  const descriptionTokenItems = useMemo<TokenCountRequestItem[]>(
    () => (assetId && mode === "description" ? [{ id: "description", text: content }] : []),
    [assetId, content, mode],
  );
  const descriptionTokenCounts = useTokenCounts(
    tokenProfileId,
    descriptionTokenItems,
    Boolean(assetId && mode === "description"),
  );
  const tagEditingActive =
    mode === "tags" || (mode === "translation" && translationSourceKind === "tags");
  const tagsDirty = tagEditingActive && !annotationTagsEqual(tagDraft, savedTagDraft);
  const dirty =
    tagsDirty ||
    (mode === "translation"
      ? translationEditing && content !== savedContent
      : mode === "tags"
        ? false
        : content !== savedContent);
  const dirtyRef = useRef(dirty);
  const loadedDocumentKey = useRef("");
  dirtyRef.current = dirty;
  const history = useAnnotationChannelHistory(
    projectId,
    assetId,
    mode,
    activeLanguage,
    showHistory,
    translationSourceKind,
    translationProducerKind,
  );
  const languageOptions = useMemo(
    () =>
      Array.from(
        new Set([
          ...DEFAULT_LANGUAGES,
          language,
          ...(translations.data?.map((item) => item.language) ?? []),
        ]),
      ),
    [language, translations.data],
  );
  const hasExistingAnnotation = hasExistingAnnotationDocument(bundle.data?.documents);
  const dictionaryTags = useMemo(
    () => tagDraft.map((tag) => ({ name: tag.name, category: tag.category })),
    [tagDraft],
  );
  const dictionaryPreview = useTagDictionaryResolution(
    dictionaryTags,
    language,
    mode === "translation" &&
      translationSourceKind === "tags" &&
      translationProducerKind === "local_dictionary",
  );

  useUnsavedScope(`${tagsDirty ? "annotation-tags" : "annotation"}:${projectId}`, dirty);
  useEffect(
    () => onDirtyChange(dirty, dirty ? (tagsDirty ? "tags" : "annotation") : null),
    [dirty, onDirtyChange, tagsDirty],
  );
  useEffect(
    () =>
      onActiveTargetChange(
        mode === "translation" && tagsDirty
          ? {
              channel: "tags",
              language: "",
              translation_source_kind: null,
              translation_producer_kind: null,
            }
          : {
              channel: mode,
              language: activeLanguage,
              translation_source_kind: mode === "translation" ? translationSourceKind : null,
              translation_producer_kind: mode === "translation" ? translationProducerKind : null,
            },
      ),
    [
      activeLanguage,
      mode,
      onActiveTargetChange,
      tagsDirty,
      translationProducerKind,
      translationSourceKind,
    ],
  );

  useEffect(() => {
    const key = `${assetId ?? ""}:${mode}:${activeLanguage}:${translationSourceKind}:${translationProducerKind}`;
    if (!assetId) {
      loadedDocumentKey.current = key;
      setContent("");
      setSavedContent("");
      setSavedRevisionId(null);
      setTagDraft([]);
      setSavedTagDraft([]);
      setSavedTagRevisionId(null);
      setTranslationEditing(false);
      return;
    }
    if (
      !document.data ||
      (mode === "translation" && !translationState.data) ||
      (tagEditingActive && !tagsDocument.data)
    ) {
      return;
    }
    if (loadedDocumentKey.current !== key || !dirtyRef.current) {
      const next =
        mode === "translation"
          ? (translationState.data?.content ?? "")
          : documentDraft(document.data);
      const nextTags =
        mode === "tags"
          ? document.data.tags
          : mode === "translation" && translationSourceKind === "tags"
            ? (tagsDocument.data?.tags ?? [])
            : [];
      loadedDocumentKey.current = key;
      setContent(next);
      setSavedContent(next);
      setSavedRevisionId(document.data.head_revision_id);
      setTagDraft([...nextTags]);
      setSavedTagDraft([...nextTags]);
      setSavedTagRevisionId(
        mode === "tags"
          ? document.data.head_revision_id
          : (tagsDocument.data?.head_revision_id ?? null),
      );
    }
  }, [
    activeLanguage,
    assetId,
    document.data,
    mode,
    tagEditingActive,
    tagsDocument.data,
    translationProducerKind,
    translationSourceKind,
    translationState.data,
  ]);

  useEffect(() => {
    if (
      mode !== "existing_annotation" ||
      bundle.isLoading ||
      hasExistingAnnotation ||
      dirtyRef.current
    ) {
      return;
    }
    resetDraft();
    setMode("description");
  }, [bundle.isLoading, hasExistingAnnotation, mode, setMode]);

  function channelState(channel: AnnotationChannel, targetLanguage = "") {
    const item = bundle.data?.documents.find(
      (candidate) =>
        candidate.channel === channel &&
        (candidate.language ?? "") === targetLanguage &&
        (channel !== "translation" ||
          (candidate.translation_source_kind === translationSourceKind &&
            candidate.translation_producer_kind === translationProducerKind)),
    );
    if (!item || item.availability_status === "missing") return undefined;
    if (item.availability_status !== "usable") return item.availability_status;
    return item.review_status === "reviewed" ? "reviewed" : "usable";
  }

  function resetDraft() {
    loadedDocumentKey.current = "";
    setContent("");
    setSavedContent("");
    setSavedRevisionId(null);
    setTagDraft([]);
    setSavedTagDraft([]);
    setSavedTagRevisionId(null);
    setActionErrorMessage(null);
    setShowHistory(false);
    setTranslationEditing(false);
  }

  async function confirmDiscard(title: string, message: string): Promise<boolean> {
    if (!dirty) return true;
    return confirm({ message, title, tone: "danger", confirmLabel: "放弃并切换" });
  }

  function translationDiscardMessage(fallback: string): string {
    return tagsDirty ? "当前 Tags 修改尚未保存，确定丢弃后继续切换吗？" : fallback;
  }

  async function changeMode(next: AnnotationChannel) {
    if (next === mode) return;
    if (
      !(await confirmDiscard(
        "切换标注通道",
        tagsDirty
          ? "当前 Tags 修改尚未保存，确定丢弃后切换通道吗？"
          : "当前通道有尚未保存的修改。确定放弃后切换吗？",
      ))
    ) {
      return;
    }
    resetDraft();
    setMode(next);
  }

  async function changeLanguage(next: string) {
    if (next === language) return;
    if (
      !(await confirmDiscard(
        "切换译文语言",
        translationDiscardMessage("当前译文有尚未保存的修改。确定放弃后切换吗？"),
      ))
    ) {
      return;
    }
    resetDraft();
    setLanguage(next);
  }

  async function changeTranslationSource(next: TranslationSourceKind) {
    if (next === translationSourceKind) return;
    if (
      !(await confirmDiscard(
        "切换译文来源",
        translationDiscardMessage("当前译文有尚未保存的修改。确定放弃后切换吗？"),
      ))
    ) {
      return;
    }
    resetDraft();
    setTranslationSourceKind(next);
  }

  async function changeTranslationProducer(next: TranslationProducerKind) {
    if (next === translationProducerKind) return;
    if (
      !(await confirmDiscard(
        "切换译文生成方式",
        translationDiscardMessage("当前译文有尚未保存的修改。确定放弃后切换吗？"),
      ))
    ) {
      return;
    }
    resetDraft();
    setTranslationProducerKind(next);
    if (next === "local_dictionary") setTranslationSourceKind("tags");
  }

  async function cancelTranslationEdit() {
    if (!(await confirmDiscard("取消编辑译文", "当前译文有尚未保存的修改。确定放弃吗？"))) {
      return;
    }
    const next = translationState.data?.content ?? "";
    setContent(next);
    setSavedContent(next);
    setTranslationEditing(false);
    setActionErrorMessage(null);
  }

  async function cancelTagChanges() {
    if (!tagsDirty) return;
    const accepted = await confirm({
      message: "丢弃当前尚未保存的 Tags 修改吗？",
      title: "放弃 Tags 修改",
      tone: "danger",
      confirmLabel: "丢弃修改",
      cancelLabel: "继续编辑",
    });
    if (!accepted) return;
    setTagDraft([...savedTagDraft]);
    setActionErrorMessage(null);
  }

  async function saveTagDraft() {
    if (!assetId || !tagsDirty) return;
    const submittedTags = [...tagDraft];
    setActionErrorMessage(null);
    try {
      const result = await saveTags.mutateAsync({
        tags: submittedTags,
        expectedHeadRevisionId: savedTagRevisionId,
      });
      setTagDraft((current) => reconcilePersistedTags(current, submittedTags, result.tags));
      setSavedTagDraft([...result.tags]);
      setSavedTagRevisionId(result.head_revision_id);
      if (mode === "tags") setSavedRevisionId(result.head_revision_id);

      if (
        mode === "translation" &&
        translationProducerKind === "local_dictionary" &&
        result.tags.length
      ) {
        if (!result.head_revision_id) {
          throw new Error("Tags 已保存，但服务没有返回新的源修订 ID。");
        }
        try {
          const refreshed = await refreshLocalDictionary.mutateAsync({
            expectedSourceRevisionId: result.head_revision_id,
            expectedTranslationRevisionId: translationState.data?.modified_at ?? savedRevisionId,
          });
          setContent(refreshed.content);
          setSavedContent(refreshed.content);
          setSavedRevisionId(refreshed.modified_at);
        } catch (reason) {
          setActionErrorMessage(
            `Tags 已保存，但本地词典译文刷新失败：${actionError(reason, "未知错误")}`,
          );
        }
      }
    } catch (reason) {
      setActionErrorMessage(actionError(reason, "保存 Tags 失败。"));
    }
  }

  async function retryLocalDictionaryRefresh() {
    if (!assetId || tagsDirty || !savedTagRevisionId) return;
    setActionErrorMessage(null);
    try {
      const refreshed = await refreshLocalDictionary.mutateAsync({
        expectedSourceRevisionId: savedTagRevisionId,
        expectedTranslationRevisionId: translationState.data?.modified_at ?? savedRevisionId,
      });
      setContent(refreshed.content);
      setSavedContent(refreshed.content);
      setSavedRevisionId(refreshed.modified_at);
    } catch (reason) {
      setActionErrorMessage(actionError(reason, "刷新本地词典译文失败。"));
    }
  }

  async function saveContent() {
    if (!assetId) return;
    if (tagsDirty) {
      await saveTagDraft();
      return;
    }
    const submittedContent = content;
    setActionErrorMessage(null);
    try {
      const result = await save.mutateAsync({
        content: submittedContent,
        expectedHeadRevisionId: savedRevisionId,
      });
      const persisted = documentDraft(result);
      setContent((current) => reconcilePersistedContent(current, submittedContent, persisted));
      setSavedContent(persisted);
      setSavedRevisionId(result.head_revision_id);
      if (mode === "translation") setTranslationEditing(false);
    } catch (reason) {
      setActionErrorMessage(actionError(reason, "保存标注失败。"));
    }
  }

  async function reviewContent() {
    if (!savedRevisionId || dirty) return;
    setActionErrorMessage(null);
    try {
      const result = await review.mutateAsync(savedRevisionId);
      setSavedRevisionId(result.head_revision_id);
    } catch (reason) {
      setActionErrorMessage(actionError(reason, "复核标注失败。"));
    }
  }

  async function deleteContent() {
    if (!assetId || !document.data?.exists) return;
    const accepted = await confirm({
      message: `删除“${document.data.display_name}”的当前版本？历史修订仍会保留。`,
      title: "删除标注通道",
      tone: "danger",
      confirmLabel: "删除",
    });
    if (!accepted) return;
    setActionErrorMessage(null);
    try {
      await remove.mutateAsync();
      resetDraft();
    } catch (reason) {
      setActionErrorMessage(actionError(reason, "删除标注失败。"));
    }
  }

  function restoreRevision(revisionContent: string, tags: AnnotationTag[]) {
    if (mode === "tags") setTagDraft([...tags]);
    else setContent(revisionContent);
    if (mode === "translation") setTranslationEditing(true);
    setShowHistory(false);
  }

  const translationStatus = translationState.data?.status;
  const activeAvailabilityStatus = document.data?.availability_status ?? "missing";
  const activeReviewStatus = document.data?.review_status;
  const translationReviewBlocked =
    mode === "translation" &&
    (translationStatus !== "current" || translationState.data?.alignment_status !== "aligned");
  const translationReadOnly =
    mode === "translation" && translationProducerKind === "local_dictionary";
  const tagWritePending = saveTags.isPending || refreshLocalDictionary.isPending;
  const writePending = save.isPending || tagWritePending;
  const canRefreshLocalDictionary =
    translationReadOnly &&
    !tagsDirty &&
    Boolean(savedTagRevisionId) &&
    tagDraft.length > 0 &&
    translationStatus !== "current";

  return {
    mode,
    language,
    translationSourceKind,
    translationProducerKind,
    activeLanguage,
    bundle,
    document,
    tagsDocument,
    translationState,
    history,
    content,
    setContent,
    tagDraft,
    setTagDraft,
    translationEditing,
    setTranslationEditing,
    showHistory,
    setShowHistory,
    actionError: actionErrorMessage,
    descriptionTokenCounts,
    tagEditingActive,
    tagsDirty,
    dirty,
    languageOptions,
    hasExistingAnnotation,
    dictionaryPreview,
    channelState,
    changeMode,
    changeLanguage,
    changeTranslationSource,
    changeTranslationProducer,
    cancelTranslationEdit,
    cancelTagChanges,
    saveTagDraft,
    retryLocalDictionaryRefresh,
    saveContent,
    reviewContent,
    deleteContent,
    restoreRevision,
    translationStatus,
    activeAvailabilityStatus,
    activeReviewStatus,
    translationReviewBlocked,
    translationReadOnly,
    tagWritePending,
    writePending,
    canRefreshLocalDictionary,
    tagCount: tagDraft.length,
    deletePending: remove.isPending,
    reviewPending: review.isPending,
    refreshLocalDictionaryPending: refreshLocalDictionary.isPending,
  };
}
