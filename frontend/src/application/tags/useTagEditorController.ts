import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  useTagDictionaryResolution,
  useTagDictionarySearch,
} from "../../features/tagDictionaries/hooks";
import { useTaggerLibrary, useTaggerVocabularySearch } from "../../features/taggers/hooks";
import type { AnnotationTag, AnnotationTaggerSource } from "../../shared/api/types";
import {
  readTagVocabularyPreference,
  writeTagVocabularyPreference,
} from "../../shared/store/tagVocabularyPreference";
import {
  appendManualTags,
  appendVocabularyTag,
  groupTags,
  normalizeTagKey,
  removeTag,
  type AppendTagsResult,
} from "./tagDraft";

export interface TagSuggestion {
  name: string;
  category: string | null;
  translation: string | null;
}

export const AUTO_VOCABULARY = "auto";
const HAN_CHARACTER = /\p{Script=Han}/u;

function isChineseTagQuery(value: string): boolean {
  return HAN_CHARACTER.test(value);
}

interface UseTagEditorControllerOptions {
  projectId: string;
  assetId: string;
  tags: readonly AnnotationTag[];
  taggerSource: AnnotationTaggerSource | null;
  onChange: (tags: AnnotationTag[]) => void;
}

export function useTagEditorController({
  projectId,
  assetId,
  tags,
  taggerSource,
  onChange,
}: UseTagEditorControllerOptions) {
  const library = useTaggerLibrary();
  const [vocabularyMode, setVocabularyMode] = useState(() =>
    readTagVocabularyPreference(projectId),
  );
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [activeSuggestion, setActiveSuggestion] = useState(0);
  const [highlightedTag, setHighlightedTag] = useState<string | null>(null);
  const [armedTag, setArmedTag] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState("");
  const highlightTimer = useRef<number | null>(null);

  const readyInstallations = useMemo(
    () => library.data?.installations.filter((item) => item.status === "ready") ?? [],
    [library.data?.installations],
  );
  const sourceInstallation = useMemo(
    () =>
      readyInstallations.find(
        (item) =>
          item.id === taggerSource?.installation_id &&
          item.fingerprint === taggerSource.fingerprint,
      ) ?? null,
    [readyInstallations, taggerSource],
  );
  const selectedInstallation = useMemo(() => {
    if (vocabularyMode === AUTO_VOCABULARY) {
      if (sourceInstallation) return sourceInstallation;
      return taggerSource === null && readyInstallations.length === 1
        ? readyInstallations[0]
        : null;
    }
    return readyInstallations.find((item) => item.id === vocabularyMode) ?? null;
  }, [readyInstallations, sourceInstallation, taggerSource, vocabularyMode]);

  useEffect(() => {
    setVocabularyMode(readTagVocabularyPreference(projectId));
  }, [projectId]);

  useEffect(() => {
    setQuery("");
    setDebouncedQuery("");
    setSuggestionsOpen(false);
    setActiveSuggestion(0);
    setHighlightedTag(null);
    setArmedTag(null);
    setStatusMessage("");
  }, [assetId]);

  useEffect(() => {
    if (
      library.data &&
      vocabularyMode !== AUTO_VOCABULARY &&
      !readyInstallations.some((item) => item.id === vocabularyMode)
    ) {
      setVocabularyMode(AUTO_VOCABULARY);
      writeTagVocabularyPreference(projectId, AUTO_VOCABULARY);
    }
  }, [library.data, projectId, readyInstallations, vocabularyMode]);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [query]);

  useEffect(
    () => () => {
      if (highlightTimer.current !== null) window.clearTimeout(highlightTimer.current);
    },
    [],
  );

  const normalizedQuery = query.trim();
  const searchSettled = normalizedQuery === debouncedQuery;
  const chineseQuery = isChineseTagQuery(normalizedQuery);
  const debouncedChineseQuery = isChineseTagQuery(debouncedQuery);
  const vocabulary = useTaggerVocabularySearch(
    debouncedChineseQuery ? null : (selectedInstallation?.id ?? null),
    selectedInstallation?.fingerprint ?? "",
    debouncedChineseQuery ? "" : debouncedQuery,
  );
  const dictionarySearch = useTagDictionarySearch(
    debouncedChineseQuery ? debouncedQuery : "",
    "zh-CN",
  );
  const suggestions = useMemo<TagSuggestion[]>(() => {
    if (!searchSettled) return [];
    if (debouncedChineseQuery) {
      return (
        dictionarySearch.data?.items.map((item) => ({
          name: item.tag,
          category: item.category,
          translation: item.effective_translation?.trim() || null,
        })) ?? []
      );
    }
    const result = vocabulary.data;
    return result && result.fingerprint === selectedInstallation?.fingerprint
      ? result.items.map((item) => ({ ...item, translation: null }))
      : [];
  }, [
    debouncedChineseQuery,
    dictionarySearch.data?.items,
    searchSettled,
    selectedInstallation?.fingerprint,
    vocabulary.data,
  ]);
  const suggestionTags = useMemo(
    () =>
      debouncedChineseQuery
        ? []
        : suggestions.map((item) => ({ name: item.name, category: item.category })),
    [debouncedChineseQuery, suggestions],
  );
  const suggestionTranslations = useTagDictionaryResolution(
    suggestionTags,
    "zh-CN",
    suggestionsOpen && suggestionTags.length > 0,
  );
  const existingKeys = useMemo(() => new Set(tags.map((tag) => normalizeTagKey(tag.name))), [tags]);
  const groups = useMemo(() => groupTags(tags), [tags]);
  const currentOption = suggestions[activeSuggestion] ?? null;
  const showSuggestions =
    suggestionsOpen && Boolean(normalizedQuery) && (chineseQuery || Boolean(selectedInstallation));
  const suggestionsFetching =
    !searchSettled || (chineseQuery ? dictionarySearch.isFetching : vocabulary.isFetching);
  const suggestionsError =
    searchSettled && (chineseQuery ? dictionarySearch.isError : vocabulary.isError);

  useEffect(() => {
    setActiveSuggestion(0);
  }, [debouncedQuery, selectedInstallation?.id]);

  const setVocabulary = useCallback(
    (value: string) => {
      setVocabularyMode(value);
      writeTagVocabularyPreference(projectId, value);
      setQuery("");
      setDebouncedQuery("");
      setSuggestionsOpen(false);
    },
    [projectId],
  );

  const flashTag = useCallback((key: string) => {
    if (highlightTimer.current !== null) window.clearTimeout(highlightTimer.current);
    setHighlightedTag(key);
    highlightTimer.current = window.setTimeout(() => {
      setHighlightedTag(null);
      highlightTimer.current = null;
    }, 900);
  }, []);

  const applyAppend = useCallback(
    (result: AppendTagsResult) => {
      if (result.addedCount) {
        onChange(result.tags);
        setStatusMessage(`已添加 ${result.addedCount} 个 Tag。`);
      }
      if (result.duplicateKey) {
        flashTag(result.duplicateKey);
        setStatusMessage("这个 Tag 已经存在。");
      }
      setQuery("");
      setDebouncedQuery("");
      setSuggestionsOpen(false);
      setArmedTag(null);
    },
    [flashTag, onChange],
  );

  const addManual = useCallback(
    (value = query) => {
      if (!value.trim()) return;
      applyAppend(appendManualTags(tags, value));
    },
    [applyAppend, query, tags],
  );
  const addSuggestion = useCallback(
    (item: TagSuggestion) => applyAppend(appendVocabularyTag(tags, item)),
    [applyAppend, tags],
  );
  const deleteTag = useCallback(
    (key: string) => {
      const tag = tags.find((item) => normalizeTagKey(item.name) === key);
      onChange(removeTag(tags, key));
      setArmedTag(null);
      setStatusMessage(tag ? `已删除 ${tag.name}。` : "已删除 Tag。");
    },
    [onChange, tags],
  );
  const handleBackspace = useCallback(() => {
    if (query || !tags.length) return;
    const lastTag = tags.at(-1)!;
    const lastKey = normalizeTagKey(lastTag.name);
    if (armedTag === lastKey) deleteTag(lastKey);
    else {
      setArmedTag(lastKey);
      setStatusMessage(`再次按 Backspace 删除 ${lastTag.name}。`);
    }
  }, [armedTag, deleteTag, query, tags]);

  function autoVocabularyLabel(): string {
    if (sourceInstallation) return `跟随来源 · ${sourceInstallation.name}`;
    if (taggerSource) return `跟随来源 · ${taggerSource.installation_name}（不可用）`;
    if (readyInstallations.length === 1) return `自动 · ${readyInstallations[0].name}`;
    return "跟随标注来源";
  }

  function vocabularyHint(): string {
    if (selectedInstallation) {
      if (vocabularyMode === AUTO_VOCABULARY && sourceInstallation) {
        return `正在跟随当前标注来源：${selectedInstallation.name} · ${selectedInstallation.model_version}`;
      }
      if (vocabularyMode === AUTO_VOCABULARY) {
        return `当前标注没有模型来源，自动使用唯一可用词库：${selectedInstallation.name}`;
      }
      return `已手动选择词库：${selectedInstallation.name} · ${selectedInstallation.model_version}`;
    }
    if (taggerSource) return "当前标注的来源模型已删除或文件发生变化，请手动选择一个可用词库。";
    if (readyInstallations.length > 1) return "当前标注没有模型来源，请选择自动补全词库。";
    return "没有可用的本地 Tagger 词库，仍可手动添加 Tag。";
  }

  return {
    vocabularyMode,
    query,
    setQuery,
    suggestionsOpen,
    setSuggestionsOpen,
    activeSuggestion,
    setActiveSuggestion,
    highlightedTag,
    armedTag,
    setArmedTag,
    statusMessage,
    readyInstallations,
    selectedInstallation,
    suggestions,
    suggestionTranslations,
    existingKeys,
    groups,
    currentOption,
    showSuggestions,
    suggestionsFetching,
    suggestionsError,
    chineseQuery,
    setVocabulary,
    applyAppend,
    addManual,
    addSuggestion,
    deleteTag,
    handleBackspace,
    autoVocabularyLabel,
    vocabularyHint,
  };
}
