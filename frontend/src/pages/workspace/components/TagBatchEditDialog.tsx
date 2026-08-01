import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowRight, CircleAlert, Eye, Tags, Trash2, X } from "lucide-react";

import {
  useExecuteTagBatchEdit,
  usePreviewTagBatchEdit,
} from "../../../features/annotations/hooks";
import { useTagFrequency } from "../../../features/statistics/hooks";
import { useTagDictionarySearch } from "../../../features/tagDictionaries/hooks";
import { useTaggerLibrary, useTaggerVocabularySearch } from "../../../features/taggers/hooks";
import type {
  AnnotationTagBatchDetailFilter,
  AnnotationTagBatchEditPreview,
  AnnotationTagBatchEditResult,
} from "../../../shared/api/types";
import { Button } from "../../../shared/ui/Button";
import { ModalLayer } from "../../../shared/ui/ModalLayer";
import { Spinner } from "../../../shared/ui/Spinner";
import {
  makeTagBatchRequest,
  normalizeBatchTagKey,
  type TagBatchEditMode,
  type TagBatchInsertPositionKind,
} from "./tagBatchEditState";
import { TagBatchPreviewDetails } from "./TagBatchPreviewDetails";

interface TagBatchEditDialogProps {
  projectId: string;
  open: boolean;
  assetIds: string[];
  blockedTagDraft: boolean;
  onClose: () => void;
}

type SuggestionField = "add" | "source" | "replacement";

interface Suggestion {
  name: string;
  category: string | null;
  translation: string | null;
}

const MODE_LABELS: Array<{ value: TagBatchEditMode; label: string }> = [
  { value: "add", label: "添加" },
  { value: "replace", label: "替换" },
  { value: "remove", label: "删除" },
];

const POSITION_OPTIONS: Array<{ value: TagBatchInsertPositionKind; label: string }> = [
  { value: "end", label: "列表末尾（默认）" },
  { value: "start", label: "列表开头" },
  { value: "index", label: "第 N 位" },
  { value: "before", label: "指定 Tag 前" },
  { value: "after", label: "指定 Tag 后" },
];

const PREVIEW_DETAIL_LIMIT = 20;

function isChinese(value: string): boolean {
  return /\p{Script=Han}/u.test(value);
}

function errorMessage(reason: unknown, fallback: string): string {
  return reason instanceof Error ? reason.message : fallback;
}

function SummaryStats({
  summary,
  result = false,
  showPositionStats = false,
}: {
  summary: AnnotationTagBatchEditPreview | AnnotationTagBatchEditResult;
  result?: boolean;
  showPositionStats?: boolean;
}) {
  const stats: Array<[string, number]> = [
    ["将修改的图片", summary.changed_count],
    ["保持不变", summary.unchanged_count],
    ["新建或恢复 Tags", summary.created_or_revived_count],
    ["删除后为空", summary.emptied_count],
    ["重新绑定过期 Tags", summary.stale_rebound_count],
    ["失配的 Tags 译文", summary.invalidated_tag_translation_count],
  ];
  if (showPositionStats) {
    stats.push(
      ["定位跳过", summary.position_skipped_count],
      ["夹到末尾", summary.position_clamped_count],
    );
  }
  return (
    <section className="tag-batch-dialog__summary" aria-label={result ? "执行结果" : "预览统计"}>
      <div className="tag-batch-dialog__summary-heading">
        <strong>{result ? "已完成" : "预览"}</strong>
        <span>{summary.requested_count} 张图片</span>
      </div>
      <div className="tag-batch-dialog__stats">
        {stats.map(([label, value]) => (
          <div key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
          </div>
        ))}
      </div>
      {summary.terms.length ? (
        <div className="tag-batch-dialog__terms">
          <div className="tag-batch-dialog__terms-heading">
            <span>Tag 影响</span>
            <span>命中 / 添加 / 删除</span>
          </div>
          {summary.terms.map((term) => (
            <div key={`${term.name}:${term.present_before_count}`}>
              <code title={term.name}>{term.name}</code>
              <span>
                {term.present_before_count} / {term.added_count} / {term.removed_count}
              </span>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}

export function TagBatchEditDialog({
  projectId,
  open,
  assetIds,
  blockedTagDraft,
  onClose,
}: TagBatchEditDialogProps) {
  const assetIdsKey = assetIds.join("\u0000");
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
  const [suggestionField, setSuggestionField] = useState<SuggestionField>("add");
  const [preview, setPreview] = useState<AnnotationTagBatchEditPreview | null>(null);
  const [result, setResult] = useState<AnnotationTagBatchEditResult | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
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
  const suggestions = useMemo<Suggestion[]>(() => {
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
        assetIds,
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
    setPreview(null);
    setNotice(null);
    setActionError(null);
    setDetailError(null);
    setDetailRetry(null);
    resetPreviewMutation();
    resetExecuteMutation();
  }, [resetExecuteMutation, resetPreviewMutation]);

  useEffect(() => {
    if (!open) return;
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
    setActionError(null);
    setDetailError(null);
    setDetailRetry(null);
    resetPreviewMutation();
    resetExecuteMutation();
  }, [assetIdsKey, open, resetExecuteMutation, resetPreviewMutation]);

  function updateDraft(setter: (value: string) => void, value: string) {
    setter(value);
    resetTransientState();
    setResult(null);
  }

  function updateInsertPositionKind(value: TagBatchInsertPositionKind) {
    setInsertPositionKind(value);
    resetTransientState();
    setResult(null);
    if (value === "before" || value === "after") setAnchorSuggestionsOpen(true);
    else setAnchorSuggestionsOpen(false);
  }

  function selectSuggestion(item: Suggestion) {
    const key = normalizeBatchTagKey(item.name);
    if (mode === "add") {
      updateDraft(setAddDraft, addDraft ? `${addDraft}, ${item.name}` : item.name);
      setCategoryByName((current) => new Map(current).set(key, item.category));
    } else if (suggestionField === "source") {
      updateDraft(setSourceDraft, item.name);
    } else {
      updateDraft(setReplacementDraft, item.name);
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
    setActionError(null);
    setNotice(null);
    setResult(null);
    setDetailError(null);
    setDetailRetry(null);
    try {
      setPreview(
        await previewMutation.mutateAsync({
          request: requestState.request,
          options: {
            detailFilter: "changed",
            detailOffset: 0,
            detailLimit: PREVIEW_DETAIL_LIMIT,
          },
        }),
      );
    } catch (reason) {
      setPreview(null);
      setActionError(errorMessage(reason, "批量 Tags 预览失败，请重试。"));
    }
  }

  async function loadPreviewDetails(
    detailFilter: AnnotationTagBatchDetailFilter,
    detailOffset: number,
  ) {
    if (!requestState.request || !preview) return;
    setDetailError(null);
    setDetailRetry(null);
    try {
      setPreview(
        await previewMutation.mutateAsync({
          request: requestState.request,
          options: {
            detailFilter,
            detailOffset,
            detailLimit: PREVIEW_DETAIL_LIMIT,
          },
        }),
      );
    } catch (reason) {
      setDetailError(errorMessage(reason, "实际 Tags 顺序读取失败，请重试。"));
      setDetailRetry({ filter: detailFilter, offset: detailOffset });
    }
  }

  async function executeChanges() {
    if (!requestState.request || !preview || !previewHasChanges || blockedTagDraft) return;
    setActionError(null);
    setNotice(null);
    try {
      const nextResult = await executeMutation.mutateAsync({
        ...requestState.request,
        preview_token: preview.preview_token,
      });
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
      setActionError(errorMessage(reason, "批量 Tags 执行失败，请重新预览后重试。"));
      setPreview(null);
    }
  }

  function close() {
    if (!busy) onClose();
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

  return (
    <ModalLayer
      open={open}
      onClose={close}
      backdropClassName="tag-batch-dialog-backdrop"
      panelClassName="tag-batch-dialog"
      labelledBy="tag-batch-dialog-title"
      initialFocusSelector="[data-tag-batch-close]"
    >
      <header className="tag-batch-dialog__header">
        <div>
          <span className="eyebrow">Batch Tags</span>
          <h2 id="tag-batch-dialog-title">批量编辑 Tags</h2>
        </div>
        <button
          type="button"
          data-tag-batch-close=""
          aria-label="关闭"
          disabled={busy}
          onClick={close}
        >
          <X size={17} />
        </button>
      </header>

      <div className="tag-batch-dialog__intro">
        <p>
          已选择 <strong>{assetIds.length}</strong> 张图片。{modeDescription}
        </p>
        <div className="tag-batch-dialog__modes" role="group" aria-label="Tags 批量操作">
          {MODE_LABELS.map((item) => (
            <button
              key={item.value}
              type="button"
              className={mode === item.value ? "is-active" : ""}
              aria-pressed={mode === item.value}
              disabled={busy}
              onClick={() => {
                setMode(item.value);
                setSuggestionField(item.value === "replace" ? "source" : "add");
                resetTransientState();
                setResult(null);
              }}
            >
              {item.value === "add" ? <Tags size={14} /> : null}
              {item.label}
            </button>
          ))}
        </div>
      </div>

      <div className="tag-batch-dialog__body">
        {mode === "replace" ? (
          <div className="tag-batch-dialog__replace-fields">
            <label>
              <span>旧 Tag</span>
              <div className="tag-batch-dialog__input-wrap">
                <input
                  value={sourceDraft}
                  aria-label="旧 Tag"
                  placeholder="例如 blue_hair"
                  onFocus={() => setSuggestionField("source")}
                  onChange={(event) => updateDraft(setSourceDraft, event.target.value)}
                />
                {suggestionVisible && suggestionField === "source" ? (
                  <SuggestionList
                    items={suggestions}
                    loading={suggestionsLoading}
                    onSelect={selectSuggestion}
                  />
                ) : null}
              </div>
            </label>
            <ArrowRight className="tag-batch-dialog__replace-arrow" size={17} />
            <label>
              <span>新 Tag</span>
              <div className="tag-batch-dialog__input-wrap">
                <input
                  value={replacementDraft}
                  aria-label="新 Tag"
                  placeholder="例如 cyan_hair"
                  onFocus={() => setSuggestionField("replacement")}
                  onChange={(event) => updateDraft(setReplacementDraft, event.target.value)}
                />
                {suggestionVisible && suggestionField === "replacement" ? (
                  <SuggestionList
                    items={suggestions}
                    loading={suggestionsLoading}
                    onSelect={selectSuggestion}
                  />
                ) : null}
              </div>
            </label>
          </div>
        ) : (
          <label className="tag-batch-dialog__textarea-label">
            <span>{mode === "add" ? "要添加的 Tags" : "要删除的 Tags"}</span>
            <div className="tag-batch-dialog__input-wrap">
              <textarea
                aria-label={mode === "add" ? "要添加的 Tags" : "要删除的 Tags"}
                value={mode === "add" ? addDraft : removeDraft}
                placeholder={"可输入多个 Tag，例如：\nblue_hair, red_eyes"}
                rows={4}
                onFocus={() => setSuggestionField("add")}
                onChange={(event) =>
                  mode === "add"
                    ? updateDraft(setAddDraft, event.target.value)
                    : updateDraft(setRemoveDraft, event.target.value)
                }
              />
              {suggestionVisible ? (
                <SuggestionList
                  items={suggestions}
                  loading={suggestionsLoading}
                  onSelect={selectSuggestion}
                />
              ) : null}
            </div>
          </label>
        )}
        {mode === "add" ? (
          <div className="tag-batch-dialog__position-fields">
            <label>
              <span>插入位置</span>
              <select
                aria-label="插入位置"
                value={insertPositionKind}
                disabled={busy}
                onChange={(event) =>
                  updateInsertPositionKind(event.target.value as TagBatchInsertPositionKind)
                }
              >
                {POSITION_OPTIONS.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
            {insertPositionKind === "index" ? (
              <label>
                <span>目标序号</span>
                <div className="tag-batch-dialog__inline-number">
                  <input
                    aria-label="目标序号"
                    type="number"
                    min={1}
                    step={1}
                    inputMode="numeric"
                    value={insertIndexDraft}
                    disabled={busy}
                    onChange={(event) => updateDraft(setInsertIndexDraft, event.target.value)}
                  />
                  <small>第 N 位</small>
                </div>
              </label>
            ) : null}
            {insertPositionKind === "before" || insertPositionKind === "after" ? (
              <label>
                <span>定位 Tag</span>
                <div
                  className="tag-batch-dialog__input-wrap"
                  onBlur={(event) => {
                    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                      setAnchorSuggestionsOpen(false);
                    }
                  }}
                >
                  <input
                    aria-label="定位 Tag"
                    value={insertAnchorDraft}
                    placeholder="例如 rating:safe"
                    disabled={busy}
                    onFocus={() => setAnchorSuggestionsOpen(true)}
                    onChange={(event) => {
                      updateDraft(setInsertAnchorDraft, event.target.value);
                      setAnchorSuggestionsOpen(true);
                    }}
                  />
                  {anchorSuggestionsOpen && anchorSuggestions.length ? (
                    <div
                      className="tag-batch-dialog__suggestions tag-batch-dialog__anchor-suggestions"
                      role="listbox"
                      aria-label="定位 Tag 建议"
                    >
                      {anchorSuggestions.map((item) => (
                        <button
                          key={item.value}
                          type="button"
                          role="option"
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => selectAnchorSuggestion(item.value)}
                        >
                          <span>{item.value}</span>
                          <small>{item.count} 次</small>
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              </label>
            ) : null}
          </div>
        ) : null}
        <small className="tag-batch-dialog__field-hint">
          支持逗号、换行和 CSV 引号；精确匹配不做子串替换。
          {mode === "remove" ? " 预览会显示所选图片中的命中数。" : ""}
        </small>

        {inputPresent && requestState.error ? (
          <p className="tag-batch-dialog__message is-warning">
            <CircleAlert size={14} /> {requestState.error}
          </p>
        ) : null}
        {blockedTagDraft ? (
          <p className="tag-batch-dialog__message is-warning">
            <CircleAlert size={14} /> 当前打开图片的 Tags
            有未保存修改，请先保存或放弃后再执行批量编辑。
          </p>
        ) : null}
        {actionError ? (
          <div className="tag-batch-dialog__message is-error">
            <CircleAlert size={14} />
            <span>{actionError}</span>
            {!preview && requestState.request ? (
              <button type="button" onClick={() => void previewChanges()} disabled={busy}>
                重试
              </button>
            ) : null}
          </div>
        ) : null}
        {notice ? <p className="tag-batch-dialog__message is-success">{notice}</p> : null}

        {preview ? <SummaryStats summary={preview} showPositionStats={mode === "add"} /> : null}
        {preview ? (
          <TagBatchPreviewDetails
            projectId={projectId}
            mode={mode}
            preview={preview}
            loading={previewMutation.isPending}
            error={detailError}
            onFilterChange={(filter) => void loadPreviewDetails(filter, 0)}
            onPageChange={(offset) => void loadPreviewDetails(preview.details.filter, offset)}
            onRetry={() =>
              void loadPreviewDetails(
                detailRetry?.filter ?? preview.details.filter,
                detailRetry?.offset ?? preview.details.offset,
              )
            }
          />
        ) : null}
        {result ? (
          <SummaryStats summary={result} result showPositionStats={mode === "add"} />
        ) : null}
      </div>

      <footer className="tag-batch-dialog__footer">
        <Button disabled={busy} onClick={close}>
          关闭
        </Button>
        <Button
          icon={previewMutation.isPending ? <Spinner /> : <Eye size={14} />}
          disabled={!requestState.request || Boolean(requestState.error) || busy}
          onClick={() => void previewChanges()}
        >
          预览变更
        </Button>
        <Button
          tone={mode === "remove" ? "danger" : "primary"}
          icon={
            executeMutation.isPending ? (
              <Spinner />
            ) : mode === "remove" ? (
              <Trash2 size={14} />
            ) : (
              <Tags size={14} />
            )
          }
          disabled={
            !requestState.request ||
            Boolean(requestState.error) ||
            !previewHasChanges ||
            blockedTagDraft ||
            busy
          }
          onClick={() => void executeChanges()}
        >
          {mode === "remove" ? "执行删除" : "执行修改"}
        </Button>
      </footer>
    </ModalLayer>
  );
}

function SuggestionList({
  items,
  loading,
  onSelect,
}: {
  items: Suggestion[];
  loading: boolean;
  onSelect: (item: Suggestion) => void;
}) {
  if (loading && !items.length) {
    return <div className="tag-batch-dialog__suggestions-state">搜索中…</div>;
  }
  if (!items.length) return null;
  return (
    <div className="tag-batch-dialog__suggestions" role="listbox" aria-label="Tag 建议">
      {items.map((item) => (
        <button
          key={`${item.category ?? "none"}:${item.name}`}
          type="button"
          role="option"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => onSelect(item)}
        >
          <span>{item.name}</span>
          <small>{item.translation ?? item.category ?? "未分类"}</small>
        </button>
      ))}
    </div>
  );
}
