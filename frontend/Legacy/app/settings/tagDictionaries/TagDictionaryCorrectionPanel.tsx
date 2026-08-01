import { RotateCcw, Save, Search, Trash2 } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";

import {
  useTagDictionaryActions,
  useTagDictionarySearch,
} from "../../../../src/features/tagDictionaries/hooks";
import type { TagDictionarySearchItem } from "../../../../src/shared/api/types";
import { Button } from "../../../shared/ui/Button";
import { confirmDialog } from "../../../shared/ui/dialogs";
import { Spinner } from "../../../shared/ui/Spinner";

function normalizeTag(value: string): string {
  return value.trim().toLocaleLowerCase().split(/\s+/).join("_");
}

export function TagDictionaryCorrectionPanel() {
  const actions = useTagDictionaryActions();
  const [queryDraft, setQueryDraft] = useState("");
  const [query, setQuery] = useState("");
  const search = useTagDictionarySearch(query);
  const [tag, setTag] = useState("");
  const [translation, setTranslation] = useState("");
  const [category, setCategory] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!query || !search.data?.items.length) return;
    const exact = search.data.items.find((item) => item.normalized_tag === normalizeTag(query));
    if (exact) selectEntry(exact, false);
  }, [query, search.data?.items]);

  function submitSearch(event: FormEvent) {
    event.preventDefault();
    const value = queryDraft.trim();
    if (!value) return;
    setQuery(value);
    setMessage(null);
    setError(null);
  }

  function selectEntry(item: TagDictionarySearchItem, clearFeedback = true) {
    setTag(item.tag);
    setTranslation(item.effective_translation ?? "");
    setCategory(item.override?.category ?? item.category ?? "");
    if (clearFeedback) {
      setMessage(null);
      setError(null);
    }
  }

  function resetEditor() {
    setTag(queryDraft.trim());
    setTranslation("");
    setCategory("");
    setMessage(null);
    setError(null);
  }

  async function save() {
    setMessage(null);
    setError(null);
    try {
      await actions.upsertOverride.mutateAsync({
        tag: tag.trim(),
        translation: translation.trim(),
        language: "zh-CN",
        category: category.trim() || null,
      });
      setQuery(tag.trim());
      setQueryDraft(tag.trim());
      setMessage("修正词条已保存；相关本地词典译文会标记为当前不匹配。");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "无法保存修正词条。");
    }
  }

  async function removeOverride() {
    const existing = selectedItem?.override;
    if (!existing) return;
    const accepted = await confirmDialog(
      `删除“${existing.tag}”的修正后，将重新采用优先级最高的启用词典结果。`,
      {
        title: "删除修正词条",
        tone: "danger",
        confirmLabel: "删除修正",
      },
    );
    if (!accepted) return;
    setError(null);
    try {
      await actions.removeOverride.mutateAsync({
        tag: existing.tag,
        language: existing.language,
      });
      setMessage("修正词条已删除；相关译文会要求重新生成。");
      setTranslation("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "无法删除修正词条。");
    }
  }

  const selectedItem = search.data?.items.find(
    (item) => item.tag === tag || item.normalized_tag === normalizeTag(tag),
  );
  const busy = actions.upsertOverride.isPending || actions.removeOverride.isPending;

  return (
    <div className="dictionary-corrections">
      <section className="dictionary-search">
        <header>
          <div>
            <span className="eyebrow">Effective lookup</span>
            <h3>查询当前结果</h3>
            <p>搜索 Tag 或中文译文；结果已应用“修正词条 → 词典优先级”的覆盖顺序。</p>
          </div>
        </header>
        <form onSubmit={submitSearch}>
          <label className="form-field">
            <span>Tag / 译文</span>
            <input
              value={queryDraft}
              placeholder="例如 blue_hair 或 蓝发"
              onChange={(event) => setQueryDraft(event.target.value)}
            />
          </label>
          <Button tone="primary" icon={<Search size={13} />} disabled={!queryDraft.trim()}>
            查询
          </Button>
        </form>
        <div className="dictionary-search-results">
          {search.isLoading ? <Spinner label="查询词典" /> : null}
          {search.isError ? (
            <p className="form-error">
              {search.error instanceof Error ? search.error.message : "词典查询失败。"}
            </p>
          ) : null}
          {search.data?.items.map((item) => (
            <button
              key={item.normalized_tag}
              className={selectedItem?.normalized_tag === item.normalized_tag ? "is-active" : ""}
              type="button"
              onClick={() => selectEntry(item)}
            >
              <strong>{item.tag}</strong>
              <span>{item.effective_translation ?? "未命中，将保留原 Tag"}</span>
              <small>
                {item.source_kind === "override"
                  ? "用户修正"
                  : item.source_name
                    ? `${item.source_name}${item.category ? ` · ${item.category}` : ""}`
                    : "未命中"}
              </small>
            </button>
          ))}
          {query && search.data && !search.data.items.length ? (
            <p className="dictionary-empty">没有找到词条；仍可在右侧直接创建修正。</p>
          ) : null}
        </div>
      </section>

      <section className="dictionary-override-editor">
        <header>
          <div>
            <span className="eyebrow">User correction</span>
            <h3>词条修正</h3>
            <p>内置词典保持只读；修正以独立记录覆盖，不改写下载文件。</p>
          </div>
          <Button icon={<RotateCcw size={13} />} onClick={resetEditor}>
            新建
          </Button>
        </header>
        <label className="form-field">
          <span>原始 Tag</span>
          <input value={tag} onChange={(event) => setTag(event.target.value)} />
        </label>
        <label className="form-field">
          <span>简体中文译文</span>
          <input
            value={translation}
            placeholder="输入修正后的只读对照结果"
            onChange={(event) => setTranslation(event.target.value)}
          />
        </label>
        <label className="form-field">
          <span>类别（可选）</span>
          <input
            value={category}
            placeholder="character / general / artist …"
            onChange={(event) => setCategory(event.target.value)}
          />
        </label>
        {selectedItem ? (
          <dl>
            <div>
              <dt>当前来源</dt>
              <dd>
                {selectedItem.source_kind === "override"
                  ? "用户修正"
                  : (selectedItem.source_name ?? "未命中")}
              </dd>
            </div>
            <div>
              <dt>词频</dt>
              <dd>{selectedItem.post_count?.toLocaleString() ?? "未提供"}</dd>
            </div>
          </dl>
        ) : null}
        <footer>
          {selectedItem?.override ? (
            <Button
              tone="danger"
              icon={<Trash2 size={13} />}
              disabled={busy}
              onClick={() => void removeOverride()}
            >
              删除修正
            </Button>
          ) : (
            <span />
          )}
          <Button
            tone="primary"
            icon={actions.upsertOverride.isPending ? <Spinner /> : <Save size={13} />}
            disabled={busy || !tag.trim() || !translation.trim()}
            onClick={() => void save()}
          >
            保存修正
          </Button>
        </footer>
        {message ? <p className="dictionary-action-message">{message}</p> : null}
        {error ? <p className="form-error">{error}</p> : null}
      </section>
    </div>
  );
}
