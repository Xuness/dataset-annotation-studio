import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type WheelEvent,
} from "react";
import { Plus, Search, X } from "lucide-react";

import {
  useTagDictionaryResolution,
  useTagDictionarySearch,
} from "../../../features/tagDictionaries/hooks";
import { useTaggerLibrary, useTaggerVocabularySearch } from "../../../features/taggers/hooks";
import type {
  AnnotationTag,
  AnnotationTaggerSource,
  TaggerInstallation,
} from "../../../shared/api/types";
import {
  appendManualTags,
  appendVocabularyTag,
  groupTags,
  normalizeTagKey,
  removeTag,
  type AppendTagsResult,
} from "./tagEditorState";
import { annotationTagTitle, tagCategoryLabel, tagCategoryTone } from "./tagPresentation";

interface TagEditorPanelProps {
  projectId: string;
  assetId: string;
  tags: AnnotationTag[];
  taggerSource: AnnotationTaggerSource | null;
  fontSize: number;
  onChange: (tags: AnnotationTag[]) => void;
  onFontSizeChange: (fontSize: number) => void;
  readOnly?: boolean;
  linkedTagKeys?: ReadonlySet<string>;
  onTagHoverChange?: (key: string | null) => void;
  onTagSelectionChange?: (keys: string[]) => void;
  compact?: boolean;
}

interface TagSuggestion {
  name: string;
  category: string | null;
  translation: string | null;
}

const AUTO_VOCABULARY = "auto";
const VOCABULARY_STORAGE_PREFIX = "dataset-studio.tag-vocabulary-source";
const HAN_CHARACTER = /\p{Script=Han}/u;

function vocabularyStorageKey(projectId: string): string {
  return `${VOCABULARY_STORAGE_PREFIX}.${projectId}`;
}

function readVocabularyMode(projectId: string): string {
  return window.localStorage.getItem(vocabularyStorageKey(projectId)) || AUTO_VOCABULARY;
}

function isChineseTagQuery(value: string): boolean {
  return HAN_CHARACTER.test(value);
}

function collectSelectedTagKeys(container: HTMLElement, selection: Selection | null): string[] {
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return [];
  const range = selection.getRangeAt(0);
  if (
    !container.contains(range.commonAncestorContainer) &&
    !container.contains(range.startContainer) &&
    !container.contains(range.endContainer)
  ) {
    return [];
  }
  return Array.from(container.querySelectorAll<HTMLElement>("[data-tag-key]"))
    .filter((element) => {
      try {
        return range.intersectsNode(element);
      } catch {
        return false;
      }
    })
    .map((element) => element.dataset.tagKey)
    .filter((value): value is string => Boolean(value));
}

export function TagEditorPanel({
  projectId,
  assetId,
  tags,
  taggerSource,
  fontSize,
  onChange,
  onFontSizeChange,
  readOnly = false,
  linkedTagKeys,
  onTagHoverChange,
  onTagSelectionChange,
  compact = false,
}: TagEditorPanelProps) {
  const listboxId = `tag-vocabulary-${useId().replaceAll(":", "")}`;
  const library = useTaggerLibrary();
  const [vocabularyMode, setVocabularyMode] = useState(() => readVocabularyMode(projectId));
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [activeSuggestion, setActiveSuggestion] = useState(0);
  const [highlightedTag, setHighlightedTag] = useState<string | null>(null);
  const [armedTag, setArmedTag] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState("");
  const highlightTimer = useRef<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const groupsRef = useRef<HTMLDivElement>(null);

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
    setVocabularyMode(readVocabularyMode(projectId));
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
      window.localStorage.setItem(vocabularyStorageKey(projectId), AUTO_VOCABULARY);
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
      ? result.items.map((item) => ({
          ...item,
          translation: null,
        }))
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

  function setVocabulary(value: string) {
    setVocabularyMode(value);
    window.localStorage.setItem(vocabularyStorageKey(projectId), value);
    setQuery("");
    setDebouncedQuery("");
    setSuggestionsOpen(false);
    inputRef.current?.focus();
  }

  function flashTag(key: string) {
    if (highlightTimer.current !== null) window.clearTimeout(highlightTimer.current);
    setHighlightedTag(key);
    highlightTimer.current = window.setTimeout(() => {
      setHighlightedTag(null);
      highlightTimer.current = null;
    }, 900);
  }

  function applyAppend(result: AppendTagsResult) {
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
    inputRef.current?.focus();
  }

  function addManual(value = query) {
    if (!value.trim()) return;
    applyAppend(appendManualTags(tags, value));
  }

  function addSuggestion(item: TagSuggestion) {
    applyAppend(appendVocabularyTag(tags, item));
  }

  function deleteTag(key: string) {
    const tag = tags.find((item) => normalizeTagKey(item.name) === key);
    onChange(removeTag(tags, key));
    setArmedTag(null);
    setStatusMessage(tag ? `已删除 ${tag.name}。` : "已删除 Tag。");
  }

  function handleInputKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (readOnly) return;
    if (event.nativeEvent.isComposing) return;
    if (event.key === "ArrowDown" && showSuggestions && suggestions.length) {
      event.preventDefault();
      setActiveSuggestion((current) => (current + 1) % suggestions.length);
      return;
    }
    if (event.key === "ArrowUp" && showSuggestions && suggestions.length) {
      event.preventDefault();
      setActiveSuggestion((current) => (current - 1 + suggestions.length) % suggestions.length);
      return;
    }
    if ((event.key === "Enter" || event.key === "Tab") && currentOption && showSuggestions) {
      event.preventDefault();
      addSuggestion(currentOption);
      return;
    }
    if (event.key === "Enter" || event.key === ",") {
      event.preventDefault();
      addManual();
      return;
    }
    if (event.key === "Escape") {
      setSuggestionsOpen(false);
      setArmedTag(null);
      return;
    }
    if (event.key === "Backspace" && !query && tags.length) {
      event.preventDefault();
      const lastKey = normalizeTagKey(tags.at(-1)!.name);
      if (armedTag === lastKey) {
        deleteTag(lastKey);
      } else {
        setArmedTag(lastKey);
        setStatusMessage(`再次按 Backspace 删除 ${tags.at(-1)!.name}。`);
      }
    }
  }

  function handleWheel(event: WheelEvent<HTMLDivElement>) {
    if (!event.ctrlKey || event.deltaY === 0) return;
    event.preventDefault();
    onFontSizeChange(Math.min(22, Math.max(10, fontSize + (event.deltaY < 0 ? 1 : -1))));
  }

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
    if (taggerSource) {
      return "当前标注的来源模型已删除或文件发生变化，请手动选择一个可用词库。";
    }
    if (readyInstallations.length > 1) return "当前标注没有模型来源，请选择自动补全词库。";
    return "没有可用的本地 Tagger 词库，仍可手动添加 Tag。";
  }

  return (
    <div
      className={[
        "tag-editor",
        readOnly ? "tag-editor--readonly" : "",
        compact ? "tag-editor--compact" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      onWheel={handleWheel}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setSuggestionsOpen(false);
        }
      }}
    >
      {!readOnly ? (
        <div className="tag-editor__toolbar">
          <div className="tag-editor__combobox">
            <Search size={14} aria-hidden="true" />
            <input
              ref={inputRef}
              value={query}
              role="combobox"
              aria-label="搜索或添加 Tag"
              aria-autocomplete="list"
              aria-expanded={showSuggestions}
              aria-controls={showSuggestions ? listboxId : undefined}
              aria-activedescendant={
                showSuggestions && currentOption
                  ? `${listboxId}-option-${activeSuggestion}`
                  : undefined
              }
              placeholder="搜索或输入 Tag，支持中文…"
              onFocus={() => setSuggestionsOpen(true)}
              onChange={(event) => {
                setQuery(event.target.value);
                setSuggestionsOpen(true);
                setArmedTag(null);
              }}
              onKeyDown={handleInputKeyDown}
              onPaste={(event) => {
                const pasted = event.clipboardData.getData("text");
                if (!/[,\r\n]/u.test(pasted)) return;
                event.preventDefault();
                applyAppend(appendManualTags(tags, pasted));
              }}
            />
            {showSuggestions && suggestionsFetching ? (
              <span className="tag-editor__search-state">搜索中</span>
            ) : null}
            <button
              type="button"
              className="tag-editor__add"
              aria-label="添加输入的 Tag"
              disabled={!query.trim()}
              onClick={() =>
                currentOption && showSuggestions ? addSuggestion(currentOption) : addManual()
              }
            >
              <Plus size={15} />
            </button>

            {showSuggestions ? (
              <div id={listboxId} className="tag-editor__suggestions" role="listbox">
                {suggestionsError ? (
                  <p className="tag-editor__suggestion-message">
                    {chineseQuery ? "无法读取中文 Tag 词典。" : "无法读取模型词库。"}
                  </p>
                ) : suggestions.length ? (
                  suggestions.map((item, index) => {
                    const key = normalizeTagKey(item.name);
                    const exists = existingKeys.has(key);
                    const translationEntry = suggestionTranslations.data?.entries[index];
                    const translation =
                      item.translation ??
                      (translationEntry?.requested_tag === item.name
                        ? translationEntry.translation?.trim() || null
                        : null);
                    const translationLabel =
                      translation ??
                      (suggestionTranslations.isResolving
                        ? "查询中文译文…"
                        : suggestionTranslations.isError
                          ? "中文译文不可用"
                          : "暂无中文译文");
                    return (
                      <button
                        id={`${listboxId}-option-${index}`}
                        key={`${item.category ?? "uncategorized"}:${item.name}`}
                        type="button"
                        role="option"
                        aria-selected={index === activeSuggestion}
                        className={index === activeSuggestion ? "is-active" : ""}
                        onMouseDown={(event) => event.preventDefault()}
                        onMouseEnter={() => setActiveSuggestion(index)}
                        onClick={() => addSuggestion(item)}
                      >
                        <span className="tag-editor__suggestion-label">
                          <span className="tag-editor__suggestion-name" title={item.name}>
                            {item.name}
                          </span>
                          <span
                            className={[
                              "tag-editor__suggestion-translation",
                              translation ? "" : "is-empty",
                            ]
                              .filter(Boolean)
                              .join(" ")}
                            title={translationLabel}
                          >
                            {translationLabel}
                          </span>
                        </span>
                        <small>
                          {tagCategoryLabel(item.category)}
                          {exists ? " · 已存在" : ""}
                        </small>
                      </button>
                    );
                  })
                ) : suggestionsFetching ? (
                  <p className="tag-editor__suggestion-message">正在搜索词库…</p>
                ) : (
                  <p className="tag-editor__suggestion-message">
                    {chineseQuery
                      ? "中文词典中没有匹配 Tag，按 Enter 可将原文作为手动 Tag 添加。"
                      : "词库中没有匹配项，按 Enter 可作为手动 Tag 添加。"}
                  </p>
                )}
              </div>
            ) : null}
          </div>

          <select
            className="tag-editor__vocabulary-select"
            aria-label="自动补全词库"
            title={vocabularyHint()}
            value={vocabularyMode}
            onChange={(event) => setVocabulary(event.target.value)}
          >
            <option value={AUTO_VOCABULARY}>{autoVocabularyLabel()}</option>
            {readyInstallations.map((installation: TaggerInstallation) => (
              <option key={installation.id} value={installation.id}>
                {installation.name} · {installation.model_version}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      <div
        ref={groupsRef}
        className="tag-editor__groups"
        onMouseUp={() => {
          if (!onTagSelectionChange || !groupsRef.current) return;
          const keys = collectSelectedTagKeys(groupsRef.current, window.getSelection());
          if (keys.length) onTagSelectionChange(Array.from(new Set(keys)));
        }}
      >
        {groups.length ? (
          groups.map((group) => {
            const label = tagCategoryLabel(group.category);
            const headingId = `${listboxId}-group-${group.category ?? "uncategorized"}`;
            return (
              <section
                key={group.category ?? "uncategorized"}
                className="tag-editor__group"
                data-category-tone={tagCategoryTone(group.category)}
                aria-labelledby={headingId}
              >
                <header id={headingId}>
                  <strong>{label}</strong>
                  <span>{group.items.length}</span>
                </header>
                <div className="tag-editor__chips">
                  {group.items.map(({ key, tag }) => (
                    <span
                      key={key}
                      className={[
                        "tag-editor__chip",
                        highlightedTag === key ? "is-highlighted" : "",
                        armedTag === key ? "is-armed" : "",
                        linkedTagKeys?.has(key) ? "is-linked" : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                      data-tag-key={key}
                      title={annotationTagTitle(tag)}
                      onPointerEnter={() => onTagHoverChange?.(key)}
                      onPointerLeave={() => onTagHoverChange?.(null)}
                    >
                      <span>{tag.name}</span>
                      {tag.confidence !== null ? (
                        <small>{Math.round(tag.confidence * 100)}%</small>
                      ) : null}
                      {!readOnly ? (
                        <button
                          type="button"
                          aria-label={`删除 Tag：${tag.name}`}
                          onClick={() => deleteTag(key)}
                        >
                          <X size={12} />
                        </button>
                      ) : null}
                    </span>
                  ))}
                </div>
              </section>
            );
          })
        ) : (
          <div className="tag-editor__empty">
            <strong>还没有 Tag</strong>
            <span>在上方输入、搜索，或者粘贴逗号与换行分隔的 Tag。</span>
          </div>
        )}
      </div>
      <span className="tag-editor__status" role="status" aria-live="polite">
        {statusMessage}
      </span>
    </div>
  );
}
