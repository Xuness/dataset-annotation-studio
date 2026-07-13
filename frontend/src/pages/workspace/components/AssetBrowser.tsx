import { useEffect, useMemo, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { CheckCircle2, CircleAlert, FileQuestion, Search } from "lucide-react";

import { thumbnailUrl } from "../../../features/assets/api";
import type { AnnotationStatus, AssetSummary } from "../../../shared/api/types";
import { Spinner } from "../../../shared/ui/Spinner";
import { StatusDot } from "../../../shared/ui/StatusDot";

type StatusFilter = AnnotationStatus | null;

interface AssetBrowserProps {
  mode?: "assets" | "review";
  projectId: string;
  assets: AssetSummary[];
  total: number;
  selectedAssetId: string | null;
  checkedAssetIds: string[];
  search: string;
  statusFilter: StatusFilter;
  statusCounts: Record<string, number>;
  recursive: boolean;
  hasMore: boolean;
  loading: boolean;
  loadingMore: boolean;
  selectAllPending: boolean;
  allMatchingSelected: boolean;
  error: string | null;
  onSearchChange: (value: string) => void;
  onStatusChange: (value: StatusFilter) => void;
  onSelect: (assetId: string) => void;
  onSetChecked: (assetIds: string[], checked: boolean) => void;
  onToggleAll: () => void;
  onRecursiveChange: (value: boolean) => void;
  onLoadMore: () => void;
}

const assetFilters: Array<{ value: StatusFilter; label: string; icon: typeof CheckCircle2 }> = [
  { value: null, label: "全部", icon: CheckCircle2 },
  { value: "missing", label: "未标注", icon: FileQuestion },
  { value: "invalid", label: "异常", icon: CircleAlert },
];

const reviewFilters: Array<{ value: StatusFilter; label: string; icon: typeof CheckCircle2 }> = [
  { value: "invalid", label: "标签异常", icon: CircleAlert },
  { value: "empty", label: "空文件", icon: FileQuestion },
  { value: "unchecked", label: "未校验", icon: FileQuestion },
];

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function AssetBrowser({
  mode = "assets",
  projectId,
  assets,
  total,
  selectedAssetId,
  checkedAssetIds,
  search,
  statusFilter,
  statusCounts,
  recursive,
  hasMore,
  loading,
  loadingMore,
  selectAllPending,
  allMatchingSelected,
  error,
  onSearchChange,
  onStatusChange,
  onSelect,
  onSetChecked,
  onToggleAll,
  onRecursiveChange,
  onLoadMore,
}: AssetBrowserProps) {
  const filters = mode === "review" ? reviewFilters : assetFilters;
  const scrollRef = useRef<HTMLDivElement>(null);
  const rangeAnchorIdRef = useRef<string | null>(null);
  const checkedAssetIdSet = useMemo(() => new Set(checkedAssetIds), [checkedAssetIds]);
  const virtualizer = useVirtualizer({
    count: assets.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 70,
    overscan: 8,
  });
  const virtualItems = virtualizer.getVirtualItems();

  useEffect(() => {
    const lastVisible = virtualItems.at(-1);
    if (lastVisible && lastVisible.index >= assets.length - 12 && hasMore && !loadingMore) {
      onLoadMore();
    }
  }, [assets.length, hasMore, loadingMore, onLoadMore, virtualItems]);

  useEffect(() => {
    rangeAnchorIdRef.current = null;
  }, [mode, projectId, search, statusFilter]);

  function toggleChecked(assetId: string, shiftKey: boolean) {
    const targetIndex = assets.findIndex((asset) => asset.id === assetId);
    const anchorId = rangeAnchorIdRef.current ?? selectedAssetId;
    const anchorIndex = anchorId ? assets.findIndex((asset) => asset.id === anchorId) : -1;
    const shouldCheck = !checkedAssetIdSet.has(assetId);

    if (shiftKey && targetIndex >= 0 && anchorIndex >= 0) {
      const start = Math.min(anchorIndex, targetIndex);
      const end = Math.max(anchorIndex, targetIndex);
      onSetChecked(
        assets.slice(start, end + 1).map((asset) => asset.id),
        shouldCheck,
      );
    } else {
      onSetChecked([assetId], shouldCheck);
    }
    rangeAnchorIdRef.current = assetId;
  }

  function handleRowClick(assetId: string, shiftKey: boolean) {
    if (shiftKey) {
      toggleChecked(assetId, true);
      return;
    }
    rangeAnchorIdRef.current = assetId;
    onSelect(assetId);
  }

  return (
    <aside className="asset-browser">
      <div className="asset-browser__header">
        <div>
          <span className="eyebrow">{mode === "review" ? "Review Queue" : "Dataset"}</span>
          <strong>{total} 张图片</strong>
        </div>
        <label className="switch-label" title="扫描所有子文件夹">
          <input
            type="checkbox"
            checked={recursive}
            onChange={(event) => onRecursiveChange(event.target.checked)}
          />
          <span />
          递归
        </label>
      </div>

      <label className="search-field">
        <Search size={14} />
        <input
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder="搜索文件名或路径"
        />
      </label>

      <div className="asset-filters">
        {filters.map(({ value, label, icon: Icon }) => {
          const count = value ? (statusCounts[value] ?? 0) : total;
          return (
            <button
              key={label}
              className={statusFilter === value ? "is-active" : ""}
              onClick={() => onStatusChange(value)}
            >
              <Icon size={13} /> {label} <span>{count}</span>
            </button>
          );
        })}
      </div>

      <div className="asset-selection-toolbar">
        <button
          type="button"
          className="asset-selection-toolbar__toggle"
          aria-pressed={allMatchingSelected}
          disabled={loading || selectAllPending || total === 0}
          onClick={onToggleAll}
        >
          <span className={`asset-check ${allMatchingSelected ? "is-checked" : ""}`}>
            {allMatchingSelected ? "✓" : ""}
          </span>
          {selectAllPending ? "正在全选…" : allMatchingSelected ? "取消全选" : "全选"}
        </button>
        <span className="asset-selection-toolbar__count">已选 {checkedAssetIds.length}</span>
        <span className="asset-selection-toolbar__hint" title="按住 Shift 点击可连续选择或取消">
          Shift 连选
        </span>
      </div>

      <div className="asset-list" ref={scrollRef}>
        {loading ? (
          <div className="asset-list__empty">
            <Spinner label="读取素材" />
          </div>
        ) : error ? (
          <div className="asset-list__empty">
            <CircleAlert size={22} />
            <p>{error}</p>
          </div>
        ) : assets.length ? (
          <div className="asset-list__virtual" style={{ height: virtualizer.getTotalSize() }}>
            {virtualItems.map((virtualRow) => {
              const asset = assets[virtualRow.index];
              return (
                <button
                  key={asset.id}
                  className={`asset-row ${asset.id === selectedAssetId ? "is-selected" : ""}`}
                  style={{ transform: `translateY(${virtualRow.start}px)` }}
                  onClick={(event) => handleRowClick(asset.id, event.shiftKey)}
                >
                  <span
                    className={`asset-check ${checkedAssetIdSet.has(asset.id) ? "is-checked" : ""}`}
                    role="checkbox"
                    aria-label={`选择 ${asset.filename}`}
                    aria-checked={checkedAssetIdSet.has(asset.id)}
                    tabIndex={0}
                    onClick={(event) => {
                      event.stopPropagation();
                      toggleChecked(asset.id, event.shiftKey);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === " " || event.key === "Enter") {
                        event.preventDefault();
                        event.stopPropagation();
                        toggleChecked(asset.id, event.shiftKey);
                      }
                    }}
                  >
                    {checkedAssetIdSet.has(asset.id) ? "✓" : ""}
                  </span>
                  <img
                    src={thumbnailUrl(projectId, asset.id, asset.content_version, 160)}
                    alt=""
                    loading="lazy"
                  />
                  <span className="asset-row__copy">
                    <strong title={asset.filename}>{asset.filename}</strong>
                    <small>
                      {asset.width} × {asset.height} · {formatBytes(asset.byte_size)}
                    </small>
                    <span title={asset.relative_path}>{asset.relative_path}</span>
                  </span>
                  <StatusDot status={asset.annotation_status} />
                </button>
              );
            })}
          </div>
        ) : (
          <div className="asset-list__empty">
            {mode === "review" ? <CheckCircle2 size={22} /> : <FileQuestion size={22} />}
            <p>{mode === "review" ? "当前分类没有待审核内容。" : "没有符合当前条件的图片。"}</p>
          </div>
        )}
      </div>
      {loadingMore ? <div className="asset-list__loading">正在载入更多图片…</div> : null}
    </aside>
  );
}
