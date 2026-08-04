import { useId, useRef, type KeyboardEvent } from "react";

import type { AnnotationEditTagSurface as AnnotationEditTagSurfaceModel } from "../../../../../../pages/spaces/spacePageModel";

interface AnnotationEditTagSurfaceProps {
  model: AnnotationEditTagSurfaceModel;
  compact?: boolean;
  readOnly?: boolean;
}

export function AnnotationEditTagSurface({
  model,
  compact = false,
  readOnly = false,
}: AnnotationEditTagSurfaceProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const listboxId = `dial-archive-tag-vocabulary-${useId().replaceAll(":", "")}`;
  const activeSuggestion = model.suggestions[model.activeSuggestion] ?? null;

  function addQuery(value?: string) {
    model.addQuery(value);
    inputRef.current?.focus();
  }

  function addSuggestion(index: number) {
    model.addSuggestion(index);
    inputRef.current?.focus();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (readOnly || event.nativeEvent.isComposing) return;
    if (event.key === "ArrowDown" && model.suggestionsOpen && model.suggestions.length) {
      event.preventDefault();
      model.setActiveSuggestion((model.activeSuggestion + 1) % model.suggestions.length);
      return;
    }
    if (event.key === "ArrowUp" && model.suggestionsOpen && model.suggestions.length) {
      event.preventDefault();
      model.setActiveSuggestion(
        (model.activeSuggestion - 1 + model.suggestions.length) % model.suggestions.length,
      );
      return;
    }
    if (
      (event.key === "Enter" || event.key === "Tab") &&
      model.suggestionsOpen &&
      activeSuggestion
    ) {
      event.preventDefault();
      addSuggestion(model.activeSuggestion);
      return;
    }
    if (event.key === "Enter" || event.key === ",") {
      event.preventDefault();
      addQuery();
      return;
    }
    if (event.key === "Escape") {
      model.setSuggestionsOpen(false);
      return;
    }
    if (event.key === "Backspace" && !model.query) {
      event.preventDefault();
      model.handleEmptyBackspace();
    }
  }

  return (
    <section
      className={`dial-archive-edit-tags${compact ? " is-compact" : ""}${readOnly ? " is-readonly" : ""}`}
      aria-label="Tags 编辑面"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          model.setSuggestionsOpen(false);
        }
      }}
    >
      {!readOnly ? (
        <header className="dial-archive-edit-tags__input-row">
          <label>
            <span>VOCABULARY INPUT // SEARCH OR APPEND</span>
            <input
              ref={inputRef}
              role="combobox"
              aria-label="搜索或添加 Tag"
              aria-autocomplete="list"
              aria-expanded={model.suggestionsOpen}
              aria-controls={model.suggestionsOpen ? listboxId : undefined}
              aria-activedescendant={
                activeSuggestion ? `${listboxId}-option-${model.activeSuggestion}` : undefined
              }
              value={model.query}
              placeholder="搜索、输入或粘贴 Tag…"
              onFocus={() => model.setSuggestionsOpen(true)}
              onChange={(event) => {
                model.setQuery(event.target.value);
                model.setSuggestionsOpen(true);
              }}
              onKeyDown={handleKeyDown}
              onPaste={(event) => {
                const pasted = event.clipboardData.getData("text");
                if (!/[,\r\n]/u.test(pasted)) return;
                event.preventDefault();
                addQuery(pasted);
              }}
            />
          </label>
          <select
            aria-label="Tag 自动补全词库"
            value={model.vocabularyId}
            onChange={(event) => model.setVocabulary(event.target.value)}
          >
            {model.vocabularies.map((option) => (
              <option value={option.id} title={option.detail} key={option.id}>
                {option.label}
              </option>
            ))}
          </select>
          <button type="button" disabled={!model.query.trim()} onClick={() => addQuery()}>
            <span>ADD</span>
            <b>＋</b>
          </button>

          {model.suggestionsOpen ? (
            <div className="dial-archive-edit-tags__suggestions" id={listboxId} role="listbox">
              {model.suggestionsError ? <p>{model.suggestionsError}</p> : null}
              {!model.suggestionsError && model.suggestions.length
                ? model.suggestions.map((suggestion, index) => (
                    <button
                      id={`${listboxId}-option-${index}`}
                      type="button"
                      role="option"
                      aria-selected={index === model.activeSuggestion}
                      className={index === model.activeSuggestion ? "is-active" : undefined}
                      onMouseDown={(event) => event.preventDefault()}
                      onMouseEnter={() => model.setActiveSuggestion(index)}
                      onClick={() => addSuggestion(index)}
                      key={suggestion.id}
                    >
                      <span>
                        <b>{suggestion.name}</b>
                        <em>
                          {suggestion.translation ??
                            (suggestion.translationPending ? "查询译名…" : "暂无译名")}
                        </em>
                      </span>
                      <small>
                        {suggestion.categoryLabel}
                        {suggestion.exists ? " · 已存在" : ""}
                      </small>
                    </button>
                  ))
                : null}
              {!model.suggestionsError && !model.suggestions.length ? (
                <p>
                  {model.suggestionsPending ? "正在检索词库…" : "没有匹配项，按 Enter 手动添加。"}
                </p>
              ) : null}
            </div>
          ) : null}
        </header>
      ) : null}

      <div className="dial-archive-edit-tags__groups">
        {model.groups.length ? (
          model.groups.map((group) => (
            <section data-tone={group.tone} key={group.id}>
              <header>
                <span>{group.id.toUpperCase()}</span>
                <b>{group.label}</b>
                <em>{String(group.items.length).padStart(2, "0")}</em>
              </header>
              <div>
                {group.items.map((tag) => (
                  <span
                    className={`${tag.highlighted ? "is-highlighted" : ""}${tag.armed ? " is-armed" : ""}`}
                    title={`${tag.categoryLabel} · ${tag.origin}`}
                    key={tag.key}
                  >
                    <b>{tag.name}</b>
                    {tag.confidence !== null ? (
                      <small>{Math.round(tag.confidence * 100)}%</small>
                    ) : null}
                    {!readOnly ? (
                      <button
                        type="button"
                        aria-label={`删除 Tag：${tag.name}`}
                        onClick={() => model.removeTag(tag.key)}
                      >
                        ×
                      </button>
                    ) : null}
                  </span>
                ))}
              </div>
            </section>
          ))
        ) : (
          <div className="dial-archive-edit-tags__empty">
            <span>TAG REGISTER // EMPTY</span>
            <b>当前通道还没有 Tag</b>
            <p>
              {readOnly ? "源 Tags 尚未建立。" : "从上方搜索、输入，或粘贴逗号与换行分隔的 Tag。"}
            </p>
          </div>
        )}
      </div>

      <footer aria-live="polite">
        <span>{model.count} TAG REGISTERED</span>
        <span>{model.statusMessage}</span>
      </footer>
    </section>
  );
}
