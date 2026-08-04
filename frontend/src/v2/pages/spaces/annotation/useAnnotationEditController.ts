import { useCallback, useEffect, useMemo, useState } from "react";

import type { ConfirmInteraction } from "../../../../application/interaction";
import { useAnnotationEditorController } from "../../../../application/annotations/useAnnotationEditorController";
import { useTagEditorController } from "../../../../application/tags/useTagEditorController";
import {
  DEFAULT_TOKENIZATION_PROFILE_ID,
  TOKENIZATION_PROFILE_IDS,
} from "../../../../features/tokenization/profiles";
import type {
  AnnotationChannelTarget,
  TokenizationProfileId,
  TranslationProducerKind,
  TranslationSourceKind,
} from "../../../../shared/api/types";
import type {
  AnnotationEditChannelId,
  AnnotationEditContent,
  AnnotationEditTokenMetric,
} from "../spacePageModel";
import {
  annotationAvailabilityLabel,
  annotationRevisionSourceLabel,
  annotationTagCategoryLabel,
  annotationTranslationStatusLabel,
  isAnnotationEditChannelId,
  projectAnnotationEditChannels,
  projectAnnotationHistory,
  projectAnnotationTagGroups,
} from "./annotationEditModel";

const TOKEN_PROFILE_STORAGE_KEY = "dataset-studio.v2.annotation-token-profile";
const TOKEN_PROFILE_OPTIONS = [
  { id: "krea2", label: "Krea 2" },
  { id: "anima", label: "Anima" },
  { id: "t5", label: "T5" },
] as const;

interface UseAnnotationEditControllerOptions {
  projectId: string;
  assetId: string | null;
  requestedChannel: AnnotationEditChannelId | null;
  confirm: ConfirmInteraction;
  onChannelChange(channel: AnnotationEditChannelId): void;
}

export interface AnnotationEditControllerResult {
  content: AnnotationEditContent;
  discardImmediately(): void;
}

function readTokenProfile(): TokenizationProfileId {
  if (typeof window === "undefined") return DEFAULT_TOKENIZATION_PROFILE_ID;
  const stored = window.localStorage.getItem(TOKEN_PROFILE_STORAGE_KEY);
  return TOKENIZATION_PROFILE_IDS.includes(stored as TokenizationProfileId)
    ? (stored as TokenizationProfileId)
    : DEFAULT_TOKENIZATION_PROFILE_ID;
}

function describeError(reason: unknown, fallback: string): string {
  return reason instanceof Error ? reason.message : fallback;
}

function projectTokenMetrics(
  data: ReturnType<typeof useAnnotationEditorController>["descriptionTokenCounts"]["data"],
): AnnotationEditTokenMetric[] {
  const result = data?.items.find((item) => item.id === "description");
  if (!data || !result) return [];
  return result.metrics.map((metric) => {
    const descriptor = data.profile.metrics.find((item) => item.id === metric.metric_id);
    return {
      id: metric.metric_id,
      label: descriptor?.label ?? metric.metric_id,
      shortLabel: descriptor?.short_label ?? metric.metric_id,
      count: metric.count,
    };
  });
}

function noActiveTarget(target: AnnotationChannelTarget): void {
  void target;
}

export function useAnnotationEditController({
  projectId,
  assetId,
  requestedChannel,
  confirm,
  onChannelChange,
}: UseAnnotationEditControllerOptions): AnnotationEditControllerResult {
  const [tokenProfileId, setTokenProfileId] = useState<TokenizationProfileId>(readTokenProfile);
  const editor = useAnnotationEditorController({
    projectId,
    assetId,
    tokenProfileId,
    confirm,
    onDirtyChange: () => {},
    onActiveTargetChange: noActiveTarget,
  });
  const channel = isAnnotationEditChannelId(editor.mode) ? editor.mode : "tags";
  const { changeMode, hasExistingAnnotation } = editor;
  const tagEditor = useTagEditorController({
    projectId,
    assetId: assetId ?? "",
    tags: editor.tagDraft,
    taggerSource: editor.tagsDocument.data?.tagger_source ?? null,
    onChange: editor.setTagDraft,
  });

  useEffect(() => {
    window.localStorage.setItem(TOKEN_PROFILE_STORAGE_KEY, tokenProfileId);
  }, [tokenProfileId]);

  useEffect(() => {
    const target =
      requestedChannel === "existing_annotation" && !hasExistingAnnotation
        ? "description"
        : (requestedChannel ?? "tags");
    if (channel === target) return;
    let live = true;
    void changeMode(target).then((changed) => {
      if (!live) return;
      if (changed) onChannelChange(target);
      else onChannelChange(channel);
    });
    return () => {
      live = false;
    };
  }, [changeMode, channel, hasExistingAnnotation, onChannelChange, requestedChannel]);

  const selectChannel = useCallback(
    async (next: AnnotationEditChannelId) => {
      if (next === channel) return;
      if (next === "existing_annotation" && !hasExistingAnnotation) return;
      if (await changeMode(next)) onChannelChange(next);
    },
    [changeMode, channel, hasExistingAnnotation, onChannelChange],
  );

  const selectTokenProfile = useCallback((profileId: string) => {
    if (!TOKENIZATION_PROFILE_IDS.includes(profileId as TokenizationProfileId)) return;
    setTokenProfileId(profileId as TokenizationProfileId);
  }, []);

  const channels = useMemo(
    () =>
      projectAnnotationEditChannels(
        editor.channelState,
        editor.language,
        editor.hasExistingAnnotation,
      ),
    [editor.channelState, editor.hasExistingAnnotation, editor.language],
  );
  const tagGroups = useMemo(
    () =>
      projectAnnotationTagGroups(tagEditor.groups, tagEditor.highlightedTag, tagEditor.armedTag),
    [tagEditor.armedTag, tagEditor.groups, tagEditor.highlightedTag],
  );
  const suggestions = useMemo(
    () =>
      tagEditor.suggestions.map((suggestion, index) => {
        const resolution = tagEditor.suggestionTranslations.data?.entries[index];
        const translation =
          suggestion.translation ??
          (resolution?.requested_tag === suggestion.name
            ? resolution.translation?.trim() || null
            : null);
        return {
          id: `${suggestion.category ?? "uncategorized"}:${suggestion.name}:${index}`,
          name: suggestion.name,
          category: suggestion.category,
          categoryLabel: annotationTagCategoryLabel(suggestion.category),
          translation,
          translationPending: !translation && tagEditor.suggestionTranslations.isResolving,
          exists: tagEditor.existingKeys.has(suggestion.name.trim().toLowerCase()),
        };
      }),
    [
      tagEditor.existingKeys,
      tagEditor.suggestionTranslations.data?.entries,
      tagEditor.suggestionTranslations.isResolving,
      tagEditor.suggestions,
    ],
  );
  const { autoVocabularyLabel, readyInstallations, vocabularyHint } = tagEditor;
  const vocabularies = useMemo(
    () => [
      {
        id: "auto",
        label: autoVocabularyLabel(),
        detail: vocabularyHint(),
      },
      ...readyInstallations.map((installation) => ({
        id: installation.id,
        label: installation.name,
        detail: installation.model_version,
      })),
    ],
    [autoVocabularyLabel, readyInstallations, vocabularyHint],
  );
  const historyEntries = useMemo(
    () => projectAnnotationHistory(editor.history.data, channel, editor.translationReadOnly),
    [channel, editor.history.data, editor.translationReadOnly],
  );
  const tokenMetrics = useMemo(
    () => projectTokenMetrics(editor.descriptionTokenCounts.data),
    [editor.descriptionTokenCounts.data],
  );

  const document = editor.document.data;
  const availability = document?.availability_status ?? "missing";
  const translation = editor.translationState.data;
  const loading =
    Boolean(assetId) &&
    (editor.document.isLoading ||
      (editor.tagEditingActive && editor.tagsDocument.isLoading) ||
      (channel === "translation" && editor.translationState.isLoading));
  const failed =
    Boolean(assetId) &&
    ((editor.document.isError && !editor.document.data) ||
      (editor.tagEditingActive && editor.tagsDocument.isError && !editor.tagsDocument.data) ||
      (channel === "translation" &&
        editor.translationState.isError &&
        !editor.translationState.data));
  const message = failed
    ? describeError(
        editor.document.error ?? editor.tagsDocument.error ?? editor.translationState.error,
        "无法读取当前标注通道。",
      )
    : null;
  const sourceTags = translation?.source_tags ?? [];
  const translationSourceContent =
    editor.translationSourceKind === "tags"
      ? sourceTags.map((tag) => tag.name).join(", ")
      : (translation?.source_content ?? "");
  const historyError = editor.history.isError
    ? describeError(editor.history.error, "无法读取通道历史。")
    : null;

  const content: AnnotationEditContent = {
    status: !assetId ? "no-object" : loading ? "loading" : failed ? "error" : "ready",
    message,
    channel,
    channels,
    document: {
      displayName:
        document?.display_name ?? channels.find((item) => item.id === channel)?.title ?? "标注通道",
      exists: document?.exists ?? false,
      availability,
      availabilityLabel: annotationAvailabilityLabel(availability),
      reviewStatus: document?.review_status ?? null,
      sourceLabel: document?.source ? annotationRevisionSourceLabel(document.source) : null,
      modifiedAt: document?.modified_at ?? null,
      validationIssue: document?.validation?.issues[0]?.message ?? null,
    },
    text: editor.content,
    textPlaceholder:
      channel === "existing_annotation"
        ? "当前素材没有可读取的旧 TXT 标注。"
        : channel === "description"
          ? "在这里撰写当前素材的描述。"
          : "在这里校订译文。",
    characterCount: editor.content.length,
    lineCount: Math.max(1, editor.content.split(/\r?\n/u).length),
    tokenProfileId,
    tokenProfiles: TOKEN_PROFILE_OPTIONS,
    tokenMetrics,
    tokenMetricsPending: editor.descriptionTokenCounts.isPending,
    tags: {
      groups: tagGroups,
      count: editor.tagCount,
      query: tagEditor.query,
      statusMessage: tagEditor.statusMessage,
      vocabularyId: tagEditor.vocabularyMode,
      vocabularies,
      suggestions,
      suggestionsOpen: tagEditor.showSuggestions,
      suggestionsPending: tagEditor.suggestionsFetching,
      suggestionsError: tagEditor.suggestionsError
        ? tagEditor.chineseQuery
          ? "无法读取中文 Tag 词典。"
          : "无法读取模型词库。"
        : null,
      activeSuggestion: tagEditor.activeSuggestion,
      setQuery: tagEditor.setQuery,
      setSuggestionsOpen: tagEditor.setSuggestionsOpen,
      setActiveSuggestion: tagEditor.setActiveSuggestion,
      setVocabulary: tagEditor.setVocabulary,
      addQuery: tagEditor.addManual,
      addSuggestion: (index) => {
        const suggestion = tagEditor.suggestions[index];
        if (suggestion) tagEditor.addSuggestion(suggestion);
      },
      removeTag: tagEditor.deleteTag,
      handleEmptyBackspace: tagEditor.handleBackspace,
    },
    translation: {
      language: editor.language,
      languageOptions: editor.languageOptions,
      sourceKind: editor.translationSourceKind,
      producerKind: editor.translationProducerKind,
      sourceContent: translationSourceContent,
      sourceExists: translation?.source_exists ?? false,
      status: editor.translationStatus ?? "missing",
      statusLabel: annotationTranslationStatusLabel(editor.translationStatus),
      alignmentStatus: translation?.alignment_status ?? "unavailable",
      issue: translation?.issue ?? null,
      qualityIssues: translation?.quality_issues ?? [],
      readOnly: editor.translationReadOnly,
      editing: editor.translationEditing,
      canEdit: Boolean(assetId && translation?.source_exists && !editor.tagsDirty),
      canRefreshDictionary: editor.canRefreshLocalDictionary,
      dictionaryOverrideCount: translation?.dictionary_override_count ?? 0,
      dictionaryUnmatchedCount: translation?.dictionary_unmatched_count ?? 0,
      setLanguage: (language) => void editor.changeLanguage(language),
      setSourceKind: (source: TranslationSourceKind) => void editor.changeTranslationSource(source),
      setProducerKind: (producer: TranslationProducerKind) =>
        void editor.changeTranslationProducer(producer),
      beginEditing: () => editor.setTranslationEditing(true),
      refreshDictionary: editor.retryLocalDictionaryRefresh,
    },
    history: {
      open: editor.showHistory,
      status: !editor.showHistory
        ? "idle"
        : editor.history.isLoading
          ? "loading"
          : editor.history.isError
            ? "error"
            : "ready",
      message: historyError,
      entries: historyEntries,
      toggle: () => editor.setShowHistory((current) => !current),
      restore: (revisionId) => {
        const revision = editor.history.data?.find((item) => item.id === revisionId);
        if (revision) editor.restoreRevision(revision.content, revision.tags);
      },
    },
    dirty: editor.dirty,
    tagsDirty: editor.tagsDirty,
    writePending: editor.writePending,
    saveLabel: editor.tagsDirty
      ? "保存 Tags"
      : channel === "translation"
        ? "保存译文"
        : channel === "tags"
          ? "保存 Tags"
          : "保存当前通道",
    canSave: Boolean(assetId && editor.dirty && !editor.writePending),
    canDiscard: editor.dirty && !editor.writePending,
    actionError: editor.actionError,
    setText: editor.setContent,
    selectChannel,
    selectTokenProfile,
    save: editor.saveContent,
    discard: async () => {
      await editor.discardChanges();
    },
  };

  return {
    content,
    discardImmediately: editor.discardDraft,
  };
}
