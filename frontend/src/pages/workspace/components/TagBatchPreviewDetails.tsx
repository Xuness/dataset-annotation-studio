import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronLeft, ChevronRight, CircleAlert } from "lucide-react";

import type {
  AnnotationTag,
  AnnotationTagBatchDetailFilter,
  AnnotationTagBatchEditPreview,
} from "../../../shared/api/types";
import { Spinner } from "../../../shared/ui/Spinner";
import type { TagBatchEditMode } from "../../../application/annotations/tagBatchEditState";

interface TagBatchPreviewDetailsProps {
  mode: TagBatchEditMode;
  preview: AnnotationTagBatchEditPreview;
  loading: boolean;
  error: string | null;
  thumbnailUrlFor: (assetId: string, contentVersion: string) => string;
  onFilterChange: (filter: AnnotationTagBatchDetailFilter) => void;
  onPageChange: (offset: number) => void;
  onRetry: () => void;
}

const FILTER_LABELS: Array<{
  value: AnnotationTagBatchDetailFilter;
  label: string;
}> = [
  { value: "changed", label: "将修改" },
  { value: "position_skipped", label: "定位跳过" },
  { value: "all", label: "全部" },
];

function tagTitle(tag: AnnotationTag): string {
  return `类别：${tag.category ?? "未分类"} · 来源：${tag.origin}`;
}

function itemStatus(item: TagBatchPreviewDetailsProps["preview"]["details"]["items"][number]) {
  if (item.position_skipped) return { label: "定位跳过", tone: "skipped" };
  if (item.changed && item.position_clamped) return { label: "夹到末尾", tone: "clamped" };
  if (item.changed) return { label: "将修改", tone: "changed" };
  return { label: "无变化", tone: "unchanged" };
}

function TagSequence({
  label,
  tags,
  markedIndices,
  markClassName,
}: {
  label: string;
  tags: AnnotationTag[];
  markedIndices: number[];
  markClassName: "is-added" | "is-removed";
}) {
  const marked = useMemo(() => new Set(markedIndices), [markedIndices]);
  return (
    <section className="tag-batch-dialog__sequence" aria-label={`${label} Tags 顺序`}>
      <div className="tag-batch-dialog__sequence-heading">
        <strong>{label}</strong>
        <span>{tags.length} 个</span>
      </div>
      {tags.length ? (
        <ol className="tag-batch-dialog__sequence-list">
          {tags.map((tag, index) => (
            <li
              key={`${tag.name}:${index}`}
              className={marked.has(index) ? markClassName : undefined}
              title={tagTitle(tag)}
              aria-label={`${index + 1}. ${tag.name}，${tagTitle(tag)}`}
            >
              <span className="tag-batch-dialog__sequence-index">{index + 1}</span>
              <code>{tag.name}</code>
            </li>
          ))}
        </ol>
      ) : (
        <p className="tag-batch-dialog__sequence-empty">无 Tags</p>
      )}
    </section>
  );
}

export function TagBatchPreviewDetails({
  mode,
  preview,
  loading,
  error,
  thumbnailUrlFor,
  onFilterChange,
  onPageChange,
  onRetry,
}: TagBatchPreviewDetailsProps) {
  const details = preview.details;
  const [expandedAssetId, setExpandedAssetId] = useState<string | null>(null);
  const detailsPageKey = `${preview.preview_token}:${details.filter}:${details.offset}:${details.items
    .map((item) => item.asset_id)
    .join("\u0000")}`;
  const firstAssetId = details.items[0]?.asset_id ?? null;

  useEffect(() => {
    setExpandedAssetId(firstAssetId);
  }, [detailsPageKey, firstAssetId]);

  const filters =
    mode === "add"
      ? FILTER_LABELS
      : FILTER_LABELS.filter((item) => item.value !== "position_skipped");
  const rangeStart = details.total ? details.offset + 1 : 0;
  const rangeEnd = details.offset + details.items.length;
  const previousOffset = Math.max(0, details.offset - details.limit);
  const nextOffset = details.offset + details.limit;

  return (
    <section className="tag-batch-dialog__details" aria-label="实际 Tags 顺序">
      <header className="tag-batch-dialog__details-heading">
        <div>
          <strong>实际顺序</strong>
          <span>{details.total} 张图片</span>
        </div>
        <div className="tag-batch-dialog__detail-filters" role="group" aria-label="顺序预览范围">
          {filters.map((filter) => {
            const count =
              filter.value === "changed"
                ? preview.changed_count
                : filter.value === "position_skipped"
                  ? preview.position_skipped_count
                  : preview.requested_count;
            return (
              <button
                key={filter.value}
                type="button"
                className={details.filter === filter.value ? "is-active" : ""}
                aria-pressed={details.filter === filter.value}
                disabled={loading || details.filter === filter.value}
                onClick={() => onFilterChange(filter.value)}
              >
                {filter.label} <span>{count}</span>
              </button>
            );
          })}
        </div>
      </header>

      {error ? (
        <div className="tag-batch-dialog__details-error" role="alert">
          <CircleAlert size={14} />
          <span>{error}</span>
          <button type="button" onClick={onRetry} disabled={loading}>
            重试
          </button>
        </div>
      ) : null}

      {loading && !details.items.length ? (
        <div className="tag-batch-dialog__details-loading">
          <Spinner />
          <span>读取实际顺序…</span>
        </div>
      ) : details.items.length ? (
        <div className="tag-batch-dialog__detail-list">
          {details.items.map((item) => {
            const status = itemStatus(item);
            const expanded = expandedAssetId === item.asset_id;
            return (
              <article key={item.asset_id} className="tag-batch-dialog__detail-item">
                <button
                  type="button"
                  className="tag-batch-dialog__detail-item-header"
                  aria-expanded={expanded}
                  onClick={() => setExpandedAssetId(expanded ? null : item.asset_id)}
                >
                  <img
                    src={thumbnailUrlFor(item.asset_id, item.content_version)}
                    alt=""
                    loading="lazy"
                  />
                  <span className="tag-batch-dialog__detail-item-copy">
                    <strong title={item.filename}>{item.filename}</strong>
                    <small title={item.relative_path}>{item.relative_path}</small>
                  </span>
                  <span className={`tag-batch-dialog__detail-status is-${status.tone}`}>
                    {status.label}
                  </span>
                  <ChevronDown className={expanded ? "is-expanded" : ""} size={16} />
                </button>
                {expanded ? (
                  <div className="tag-batch-dialog__detail-item-body">
                    <TagSequence
                      label="修改前"
                      tags={item.before_tags}
                      markedIndices={item.removed_indices}
                      markClassName="is-removed"
                    />
                    <TagSequence
                      label="修改后"
                      tags={item.after_tags}
                      markedIndices={item.added_indices}
                      markClassName="is-added"
                    />
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      ) : (
        <p className="tag-batch-dialog__details-empty">当前范围没有可显示的图片。</p>
      )}

      <footer className="tag-batch-dialog__detail-pager">
        <button
          type="button"
          aria-label="上一页"
          title="上一页"
          disabled={loading || details.offset === 0}
          onClick={() => onPageChange(previousOffset)}
        >
          <ChevronLeft size={16} />
        </button>
        <span>
          {rangeStart}–{rangeEnd} / {details.total}
        </span>
        <button
          type="button"
          aria-label="下一页"
          title="下一页"
          disabled={loading || nextOffset >= details.total}
          onClick={() => onPageChange(nextOffset)}
        >
          <ChevronRight size={16} />
        </button>
      </footer>
    </section>
  );
}
