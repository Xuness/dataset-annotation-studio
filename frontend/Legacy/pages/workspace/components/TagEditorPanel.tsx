import { useId, useRef, type KeyboardEvent, type WheelEvent } from "react";
import { Plus, Search, X } from "lucide-react";

import {
  AUTO_VOCABULARY,
  useTagEditorController,
  type TagSuggestion,
} from "../../../../src/application/tags/useTagEditorController";
import { normalizeTagKey } from "../../../../src/application/tags/tagDraft";
import type {
  AnnotationTag,
  AnnotationTaggerSource,
  TaggerInstallation,
} from "../../../../src/shared/api/types";
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
  const inputRef = useRef<HTMLInputElement>(null);
  const groupsRef = useRef<HTMLDivElement>(null);
  const controller = useTagEditorController({
    projectId,
    assetId,
    tags,
    taggerSource,
    onChange,
  });
  const {
    vocabularyMode,
    query,
    setQuery,
    setSuggestionsOpen,
    activeSuggestion,
    setActiveSuggestion,
    highlightedTag,
    armedTag,
    setArmedTag,
    statusMessage,
    readyInstallations,
    suggestions,
    suggestionTranslations,
    existingKeys,
    groups,
    currentOption,
    showSuggestions,
    suggestionsFetching,
    suggestionsError,
    chineseQuery,
    setVocabulary: updateVocabulary,
    addManual: appendManual,
    addSuggestion: appendSuggestion,
    deleteTag,
    handleBackspace,
    autoVocabularyLabel,
    vocabularyHint,
  } = controller;

  function setVocabulary(value: string) {
    updateVocabulary(value);
    inputRef.current?.focus();
  }

  function addManual(value = query) {
    appendManual(value);
    inputRef.current?.focus();
  }

  function addSuggestion(item: TagSuggestion) {
    appendSuggestion(item);
    inputRef.current?.focus();
  }

  function handleInputKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (readOnly || event.nativeEvent.isComposing) return;
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
      handleBackspace();
    }
  }

  function handleWheel(event: WheelEvent<HTMLDivElement>) {
    if (!event.ctrlKey || event.deltaY === 0) return;
    event.preventDefault();
    onFontSizeChange(Math.min(22, Math.max(10, fontSize + (event.deltaY < 0 ? 1 : -1))));
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
                addManual(pasted);
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
