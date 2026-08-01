import { ArrowRight, CircleAlert, Eye, Tags, Trash2, X } from "lucide-react";

import {
  useTagBatchEditController,
  type TagBatchSuggestion,
} from "../../../../src/application/annotations/useTagBatchEditController";
import type {
  TagBatchEditMode,
  TagBatchInsertPositionKind,
} from "../../../../src/application/annotations/tagBatchEditState";
import type {
  AnnotationTagBatchEditPreview,
  AnnotationTagBatchEditResult,
} from "../../../../src/shared/api/types";
import { Button } from "../../../shared/ui/Button";
import { ModalLayer } from "../../../shared/ui/ModalLayer";
import { Spinner } from "../../../shared/ui/Spinner";
import { TagBatchPreviewDetails } from "./TagBatchPreviewDetails";

interface TagBatchEditDialogProps {
  projectId: string;
  open: boolean;
  assetIds: string[];
  blockedTagDraft: boolean;
  onClose: () => void;
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
  const controller = useTagBatchEditController({
    projectId,
    open,
    assetIds,
    blockedTagDraft,
    onClose,
  });
  const {
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
    previewPending,
    executePending,
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
    thumbnailUrlFor,
  } = controller;

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
              onClick={() => selectMode(item.value)}
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
                  disabled={executePending}
                  onFocus={() => setSuggestionField("source")}
                  onChange={(event) => updateSourceDraft(event.target.value)}
                />
                {suggestionVisible && suggestionField === "source" ? (
                  <SuggestionList
                    items={suggestions}
                    loading={suggestionsLoading}
                    disabled={executePending}
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
                  disabled={executePending}
                  onFocus={() => setSuggestionField("replacement")}
                  onChange={(event) => updateReplacementDraft(event.target.value)}
                />
                {suggestionVisible && suggestionField === "replacement" ? (
                  <SuggestionList
                    items={suggestions}
                    loading={suggestionsLoading}
                    disabled={executePending}
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
                disabled={executePending}
                onFocus={() => setSuggestionField("add")}
                onChange={(event) =>
                  mode === "add"
                    ? updateAddDraft(event.target.value)
                    : updateRemoveDraft(event.target.value)
                }
              />
              {suggestionVisible ? (
                <SuggestionList
                  items={suggestions}
                  loading={suggestionsLoading}
                  disabled={executePending}
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
                    disabled={executePending}
                    onChange={(event) => updateInsertIndex(event.target.value)}
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
                    disabled={executePending}
                    onFocus={() => setAnchorSuggestionsOpen(true)}
                    onChange={(event) => updateInsertAnchor(event.target.value)}
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
                          disabled={executePending}
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
        {error ? (
          <div className="tag-batch-dialog__message is-error">
            <CircleAlert size={14} />
            <span>{error}</span>
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
            mode={mode}
            preview={preview}
            loading={previewPending}
            error={detailError}
            thumbnailUrlFor={thumbnailUrlFor}
            onFilterChange={(filter) => void loadPreviewDetails(filter, 0)}
            onPageChange={(offset) => void loadPreviewDetails(preview.details.filter, offset)}
            onRetry={retryPreviewDetails}
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
          icon={previewPending ? <Spinner /> : <Eye size={14} />}
          disabled={!requestState.request || Boolean(requestState.error) || busy}
          onClick={() => void previewChanges()}
        >
          预览变更
        </Button>
        <Button
          tone={mode === "remove" ? "danger" : "primary"}
          icon={
            executePending ? (
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
  disabled,
  onSelect,
}: {
  items: TagBatchSuggestion[];
  loading: boolean;
  disabled: boolean;
  onSelect: (item: TagBatchSuggestion) => void;
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
          disabled={disabled}
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
