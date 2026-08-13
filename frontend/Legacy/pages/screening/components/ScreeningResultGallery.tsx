import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { CheckSquare, CircleAlert, ImageOff, LoaderCircle, Minus, Plus } from "lucide-react";

import { thumbnailUrl } from "../../../../src/features/assets/api";
import {
  adjustScreeningThumbnailSize,
  SCREENING_THUMBNAIL_SIZE_MAX,
  SCREENING_THUMBNAIL_SIZE_MIN,
  type ScreeningFilterState,
} from "../../../../src/application/screening/screeningState";
import type { ScreeningItem, ScreeningPool } from "../../../../src/shared/api/types";
import { Spinner } from "../../../shared/ui/Spinner";

const poolOptions: Array<{ value: ScreeningPool | null; label: string }> = [
  { value: null, label: "全部" },
  { value: "elite_candidate", label: "精选" },
  { value: "recommended", label: "推荐" },
  { value: "low_evidence_protected", label: "低证据保护" },
  { value: "review", label: "待审" },
  { value: "task_mismatch", label: "任务不适配" },
  { value: "low_priority_high_confidence", label: "低优先" },
  { value: "quarantine", label: "隔离" },
  { value: "invalid", label: "元数据异常" },
];

const poolLabels: Record<ScreeningPool, string> = {
  elite_candidate: "精选",
  recommended: "推荐",
  low_evidence_protected: "保护",
  review: "待审",
  task_mismatch: "任务不适配",
  low_priority_high_confidence: "低优先",
  quarantine: "隔离",
  invalid: "异常",
};

function percent(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  return `${(value <= 1 ? value * 100 : value).toFixed(1)}%`;
}

function filename(item: ScreeningItem): string {
  return item.source_relative_path.split(/[\\/]/u).at(-1) || item.source_relative_path;
}

interface Props {
  projectId: string;
  operationId: string;
  items: ScreeningItem[];
  total: number;
  filters: ScreeningFilterState;
  thumbnailSize: number;
  selectedAssetId: string | null;
  checkedAssetIds: string[];
  loading: boolean;
  fetching: boolean;
  processing: boolean;
  error: string | null;
  hasMore: boolean;
  selectCurrentPending: boolean;
  allCurrentResultsChecked: boolean;
  onChangeFilters: (update: Partial<ScreeningFilterState>) => void;
  onThumbnailSizeChange: (size: number) => void;
  onSelectAsset: (assetId: string) => void;
  onSetChecked: (assetIds: string[], checked: boolean) => void;
  onLoadMore: () => void;
  onSelectCurrent: () => void;
}

export function ScreeningResultGallery({
  projectId,
  operationId,
  items,
  total,
  filters,
  thumbnailSize,
  selectedAssetId,
  checkedAssetIds,
  loading,
  fetching,
  processing,
  error,
  hasMore,
  selectCurrentPending,
  allCurrentResultsChecked,
  onChangeFilters,
  onThumbnailSizeChange,
  onSelectAsset,
  onSetChecked,
  onLoadMore,
  onSelectCurrent,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const rangeAnchorRef = useRef<string | null>(null);
  const zoomAnchorAssetIndexRef = useRef<number | null>(null);
  const [viewportWidth, setViewportWidth] = useState(900);
  const checkedSet = useMemo(() => new Set(checkedAssetIds), [checkedAssetIds]);
  const galleryContentWidth = Math.max(1, viewportWidth - 20);
  const renderedThumbnailSize = Math.min(thumbnailSize, galleryContentWidth);
  const columns = Math.max(1, Math.floor((galleryContentWidth + 9) / (thumbnailSize + 9)));
  const rowCount = Math.ceil(items.length / columns);
  const estimatedRowHeight = renderedThumbnailSize + 80;
  const thumbnailRequestSize = thumbnailSize > 320 ? 512 : 360;
  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => estimatedRowHeight,
    overscan: 3,
  });
  const virtualRows = virtualizer.getVirtualItems();

  const requestThumbnailSize = useCallback(
    (nextSize: number) => {
      if (nextSize === thumbnailSize) return;
      const scrollTop = scrollRef.current?.scrollTop ?? 0;
      const firstVisibleRow = virtualizer
        .getVirtualItems()
        .find((virtualRow) => virtualRow.end > scrollTop);
      zoomAnchorAssetIndexRef.current = firstVisibleRow ? firstVisibleRow.index * columns : null;
      onThumbnailSizeChange(nextSize);
    },
    [columns, onThumbnailSizeChange, thumbnailSize, virtualizer],
  );

  useLayoutEffect(() => {
    virtualizer.measure();
    const anchorAssetIndex = zoomAnchorAssetIndexRef.current;
    if (anchorAssetIndex === null) return;
    zoomAnchorAssetIndexRef.current = null;
    virtualizer.scrollToIndex(Math.floor(anchorAssetIndex / columns), { align: "start" });
  }, [columns, renderedThumbnailSize, virtualizer]);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const update = () => setViewportWidth(element.clientWidth || 900);
    update();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const handleWheel = (event: globalThis.WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      if (event.deltaY === 0) return;
      requestThumbnailSize(adjustScreeningThumbnailSize(thumbnailSize, event.deltaY < 0 ? 1 : -1));
    };
    element.addEventListener("wheel", handleWheel, { passive: false });
    return () => element.removeEventListener("wheel", handleWheel);
  }, [requestThumbnailSize, thumbnailSize]);

  useEffect(() => {
    const last = virtualRows.at(-1);
    if (last && last.index >= rowCount - 3 && hasMore && !fetching) onLoadMore();
  }, [fetching, hasMore, onLoadMore, rowCount, virtualRows]);

  useEffect(() => {
    rangeAnchorRef.current = null;
  }, [filters]);

  function toggleChecked(assetId: string, shiftKey: boolean) {
    const index = items.findIndex((item) => item.asset_id === assetId);
    const anchorIndex = rangeAnchorRef.current
      ? items.findIndex((item) => item.asset_id === rangeAnchorRef.current)
      : -1;
    const nextChecked = !checkedSet.has(assetId);
    if (shiftKey && index >= 0 && anchorIndex >= 0) {
      const start = Math.min(index, anchorIndex);
      const end = Math.max(index, anchorIndex);
      onSetChecked(
        items.slice(start, end + 1).map((item) => item.asset_id),
        nextChecked,
      );
    } else {
      onSetChecked([assetId], nextChecked);
    }
    rangeAnchorRef.current = assetId;
  }

  function handleKeyboard(event: KeyboardEvent<HTMLDivElement>) {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a") {
      event.preventDefault();
      onSelectCurrent();
    }
  }

  return (
    <section className="screening-gallery" data-surface-region="content">
      <header className="screening-gallery-toolbar">
        <div className="screening-pool-tabs" role="group" aria-label="结果池">
          {poolOptions.map((option) => (
            <button
              type="button"
              key={option.label}
              className={filters.pool === option.value ? "is-active" : ""}
              onClick={() => onChangeFilters({ pool: option.value })}
            >
              {option.label}
            </button>
          ))}
        </div>
        <div className="screening-filter-row">
          <div className="screening-rating-filter" role="group" aria-label="Rating">
            {[null, "g", "s", "q", "e"].map((rating) => (
              <button
                type="button"
                key={rating ?? "all"}
                className={filters.rating === rating ? "is-active" : ""}
                onClick={() =>
                  onChangeFilters({ rating: rating as ScreeningFilterState["rating"] })
                }
              >
                {rating ?? "全部 Rating"}
              </button>
            ))}
          </div>
          <label>
            标记
            <select
              value={filters.flag ?? ""}
              onChange={(event) =>
                onChangeFilters({
                  flag: (event.target.value || null) as ScreeningFilterState["flag"],
                })
              }
            >
              <option value="">全部</option>
              <option value="low_resolution">低分辨率</option>
              <option value="pixel_duplicate">完全重复组</option>
              <option value="danbooru_variant">Danbooru 变体</option>
            </select>
          </label>
          <label className="screening-duplicate-toggle">
            <input
              type="checkbox"
              checked={filters.showDuplicates}
              onChange={(event) => onChangeFilters({ showDuplicates: event.target.checked })}
            />
            显示重复图
          </label>
          <label>
            排序
            <select
              value={filters.sort}
              onChange={(event) =>
                onChangeFilters({ sort: event.target.value as ScreeningFilterState["sort"] })
              }
            >
              <option value="selection">角色任务排序</option>
              <option value="priority">筛选优先级</option>
              <option value="percentile">Rating 内百分位</option>
              <option value="score">最终分数</option>
              <option value="path">文件路径</option>
            </select>
          </label>
          <div
            className="screening-thumbnail-zoom"
            role="group"
            aria-label="缩略图大小（Ctrl 加滚轮）"
          >
            <button
              type="button"
              title="缩小缩略图"
              aria-label="缩小缩略图"
              disabled={thumbnailSize <= SCREENING_THUMBNAIL_SIZE_MIN}
              onClick={() => requestThumbnailSize(adjustScreeningThumbnailSize(thumbnailSize, -1))}
            >
              <Minus size={14} />
            </button>
            <output title="在画廊内按 Ctrl + 滚轮也可以缩放">{thumbnailSize}px</output>
            <button
              type="button"
              title="放大缩略图"
              aria-label="放大缩略图"
              disabled={thumbnailSize >= SCREENING_THUMBNAIL_SIZE_MAX}
              onClick={() => requestThumbnailSize(adjustScreeningThumbnailSize(thumbnailSize, 1))}
            >
              <Plus size={14} />
            </button>
          </div>
        </div>
        <div className="screening-result-summary">
          <span>当前筛选子集 {total} 张</span>
          <span>已勾选 {checkedAssetIds.length} 张</span>
          <button
            type="button"
            title="仅切换当前 Rating、结果池、标记及重复图显示条件下的全部结果"
            disabled={!total || selectCurrentPending}
            onClick={onSelectCurrent}
          >
            {selectCurrentPending ? (
              <LoaderCircle className="is-spinning" size={13} />
            ) : (
              <CheckSquare size={13} />
            )}
            {selectCurrentPending
              ? "正在切换…"
              : allCurrentResultsChecked
                ? "取消勾选当前结果"
                : "勾选当前结果"}
          </button>
        </div>
      </header>

      <div
        ref={scrollRef}
        className="screening-gallery-scroll"
        role="region"
        aria-label="筛选结果画廊"
        tabIndex={0}
        onKeyDown={handleKeyboard}
      >
        {processing ? (
          <div className="screening-gallery-empty">
            <Spinner label="等待筛选完成" />
            <p>筛选运行中；完成后将一次性载入首批排序结果。</p>
          </div>
        ) : loading ? (
          <div className="screening-gallery-empty">
            <Spinner label="读取筛选结果" />
            <p>正在读取筛选结果…</p>
          </div>
        ) : error ? (
          <div className="screening-gallery-empty">
            <CircleAlert size={24} />
            <p>{error}</p>
          </div>
        ) : items.length ? (
          <div className="screening-gallery-virtual" style={{ height: virtualizer.getTotalSize() }}>
            {virtualRows.map((virtualRow) => {
              const rowItems = items.slice(
                virtualRow.index * columns,
                virtualRow.index * columns + columns,
              );
              return (
                <div
                  key={virtualRow.index}
                  ref={virtualizer.measureElement}
                  data-index={virtualRow.index}
                  className="screening-gallery-row"
                  style={{
                    gridTemplateColumns: `repeat(${columns}, minmax(0, ${renderedThumbnailSize}px))`,
                    transform: `translateY(${virtualRow.start}px)`,
                  }}
                >
                  {rowItems.map((item) => (
                    <article
                      key={item.asset_id}
                      className={`screening-card is-${item.candidate_pool ?? item.status} ${
                        selectedAssetId === item.asset_id ? "is-selected" : ""
                      }`.trim()}
                    >
                      <button
                        type="button"
                        className="screening-card-open"
                        onClick={(event) => {
                          if (event.shiftKey) toggleChecked(item.asset_id, true);
                          else onSelectAsset(item.asset_id);
                        }}
                      >
                        <span className="screening-card-image">
                          <img
                            src={thumbnailUrl(
                              projectId,
                              item.asset_id,
                              operationId,
                              thumbnailRequestSize,
                            )}
                            alt=""
                            loading="lazy"
                          />
                          <i>{item.candidate_pool ? poolLabels[item.candidate_pool] : "处理中"}</i>
                          {item.rating ? <b>Rating {item.rating}</b> : null}
                        </span>
                        <span className="screening-card-copy">
                          <strong title={filename(item)}>{filename(item)}</strong>
                          <small>
                            {item.selection_percentile !== null ? "任务百分位" : "核心百分位"}{" "}
                            {percent(item.selection_percentile ?? item.rating_percentile)}
                            {(item.selection_rank ?? item.rating_rank)
                              ? ` · #${item.selection_rank ?? item.rating_rank}`
                              : ""}
                          </small>
                          <span>
                            {item.low_resolution_flag ? <i>低分辨率</i> : null}
                            {item.pixel_duplicate_group ? <i>重复组</i> : null}
                            {item.variant_group ? <i>Danbooru 变体</i> : null}
                            {item.task_fit_score !== null && item.task_fit_score < 0.5 ? (
                              <i>任务不适配</i>
                            ) : null}
                            {item.candidate_pool === "low_evidence_protected" ? (
                              <i>低证据</i>
                            ) : null}
                          </span>
                        </span>
                      </button>
                      <button
                        type="button"
                        className={`screening-card-check ${
                          checkedSet.has(item.asset_id) ? "is-checked" : ""
                        }`}
                        role="checkbox"
                        aria-checked={checkedSet.has(item.asset_id)}
                        aria-label={`勾选 ${filename(item)}`}
                        onClick={(event) => toggleChecked(item.asset_id, event.shiftKey)}
                      >
                        {checkedSet.has(item.asset_id) ? "✓" : ""}
                      </button>
                    </article>
                  ))}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="screening-gallery-empty">
            <ImageOff size={24} />
            <p>当前条件下没有筛选结果。</p>
          </div>
        )}
        {fetching && !loading ? (
          <div className="screening-gallery-loading">正在载入更多…</div>
        ) : null}
      </div>
    </section>
  );
}
