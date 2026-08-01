import { useEffect, useMemo, useRef, type KeyboardEvent } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  BadgeCheck,
  CheckCircle2,
  CircleAlert,
  FileQuestion,
  History,
  Search,
  Tags,
  Trash2,
  Unlink,
} from "lucide-react";

import { thumbnailUrl } from "../../../../src/features/assets/api";
import type {
  AssetFilterStatus,
  AssetFolderSummary,
  AssetSummary,
} from "../../../../src/shared/api/types";
import { formatBytes } from "../../../../src/shared/format/bytes";
import { Spinner } from "../../../shared/ui/Spinner";
import { StatusDot } from "../../../shared/ui/StatusDot";
import { AssetFolderTree } from "./AssetFolderTree";

type StatusFilter = AssetFilterStatus | null;

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
  folders: AssetFolderSummary[];
  selectedFolderPath: string;
  foldersLoading: boolean;
  recursive: boolean;
  hasMore: boolean;
  loading: boolean;
  loadingMore: boolean;
  selectAllPending: boolean;
  allMatchingSelected: boolean;
  error: string | null;
  bulkActionPending: boolean;
  onSearchChange: (value: string) => void;
  onStatusChange: (value: StatusFilter) => void;
  onFolderSelect: (path: string) => Promise<boolean>;
  onSelect: (assetId: string) => Promise<boolean>;
  onSetChecked: (assetIds: string[], checked: boolean) => void;
  onToggleAll: () => void;
  onRecursiveChange: (value: boolean) => void;
  onReviewCheckedAnnotations: () => void;
  onEditCheckedTags: () => void;
  onDeleteCheckedAnnotations: () => void;
  onDeleteCheckedAssets: () => void;
  onOpenDeletionHistory: () => void;
  onLoadMore: () => void;
}

const assetFilters: Array<{ value: StatusFilter; label: string; icon: typeof CheckCircle2 }> = [
  { value: null, label: "全部", icon: CheckCircle2 },
  { value: "missing", label: "未标注", icon: FileQuestion },
  { value: "invalid", label: "异常", icon: CircleAlert },
];

const reviewFilters: Array<{ value: StatusFilter; label: string; icon: typeof CheckCircle2 }> = [
  { value: "needs_review", label: "复核与异常", icon: CircleAlert },
  { value: "unreviewed", label: "尚未复核", icon: FileQuestion },
  { value: "stale", label: "已过期", icon: CircleAlert },
  { value: "failed", label: "生成失败", icon: CircleAlert },
  { value: "invalid", label: "结构异常", icon: CircleAlert },
  { value: "encoding_error", label: "编码异常", icon: CircleAlert },
  { value: "empty", label: "空内容", icon: FileQuestion },
  { value: "unchecked", label: "未校验", icon: FileQuestion },
];

const channelStatusLabels: Record<string, string> = {
  reviewed: "已复核",
  unreviewed: "尚未复核",
  stale: "已过期",
  invalid: "结构异常",
  encoding_error: "编码异常",
  empty: "空内容",
  unchecked: "未校验",
};

function channelBadge(channel: string): { shortLabel: string; label: string; priority: number } {
  if (channel === "existing_annotation") {
    return { shortLabel: "原", label: "原有标注", priority: 0 };
  }
  if (channel === "tags") {
    return { shortLabel: "T", label: "Tags", priority: 1 };
  }
  if (channel === "description") {
    return { shortLabel: "L", label: "LLM 描述", priority: 2 };
  }
  const translationParts = channel.startsWith("translation:") ? channel.split(":") : [];
  const canonicalTranslation = translationParts.length >= 4;
  const sourceKind = canonicalTranslation ? translationParts[1] : "description";
  const language = canonicalTranslation
    ? translationParts.slice(3).join(":")
    : channel.startsWith("translation:")
      ? channel.slice("translation:".length)
      : "";
  if (!canonicalTranslation) {
    return {
      shortLabel: language || "译",
      label: language ? `${language} 译文` : "翻译",
      priority: 3,
    };
  }
  const sourceLabel = sourceKind === "tags" ? "Tags" : "LLM 描述";
  return {
    shortLabel: language ? `${sourceKind === "tags" ? "T" : "L"}·${language}` : "译",
    label: language ? `${sourceLabel} · ${language} 译文` : "翻译",
    priority: 3,
  };
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
  folders,
  selectedFolderPath,
  foldersLoading,
  recursive,
  hasMore,
  loading,
  loadingMore,
  selectAllPending,
  allMatchingSelected,
  error,
  bulkActionPending,
  onSearchChange,
  onStatusChange,
  onFolderSelect,
  onSelect,
  onSetChecked,
  onToggleAll,
  onRecursiveChange,
  onReviewCheckedAnnotations,
  onEditCheckedTags,
  onDeleteCheckedAnnotations,
  onDeleteCheckedAssets,
  onOpenDeletionHistory,
  onLoadMore,
}: AssetBrowserProps) {
  const filters = mode === "review" ? reviewFilters : assetFilters;
  const scrollRef = useRef<HTMLDivElement>(null);
  const rangeAnchorIdRef = useRef<string | null>(null);
  const checkedAssetIdSet = useMemo(() => new Set(checkedAssetIds), [checkedAssetIds]);
  const virtualizer = useVirtualizer({
    count: assets.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 72,
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
  }, [mode, projectId, search, selectedFolderPath, statusFilter]);

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

  function focusList() {
    scrollRef.current?.focus({ preventScroll: true });
  }

  async function handleRowClick(assetId: string, shiftKey: boolean) {
    if (shiftKey) {
      toggleChecked(assetId, true);
      focusList();
      return;
    }
    if (assetId === selectedAssetId) {
      rangeAnchorIdRef.current = assetId;
      focusList();
      return;
    }

    const selected = await onSelect(assetId);
    if (!selected) return;
    rangeAnchorIdRef.current = assetId;
    focusList();
  }

  async function selectByIndex(nextIndex: number) {
    const clampedIndex = Math.min(assets.length - 1, Math.max(0, nextIndex));
    const next = assets[clampedIndex];
    if (!next) return;
    if (next.id === selectedAssetId) {
      focusList();
      return;
    }

    const selected = await onSelect(next.id);
    if (!selected) return;
    rangeAnchorIdRef.current = next.id;
    virtualizer.scrollToIndex(clampedIndex, { align: "auto" });
    focusList();
    if (clampedIndex >= assets.length - 12 && hasMore && !loadingMore) onLoadMore();
  }

  function handleListKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a") {
      event.preventDefault();
      onToggleAll();
      return;
    }
    if (!assets.length) return;
    const currentIndex = assets.findIndex((asset) => asset.id === selectedAssetId);
    const pageSize = Math.max(2, Math.floor((scrollRef.current?.clientHeight ?? 500) / 72) - 1);
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        void selectByIndex(currentIndex < 0 ? 0 : currentIndex + 1);
        break;
      case "ArrowUp":
        event.preventDefault();
        void selectByIndex(currentIndex < 0 ? 0 : currentIndex - 1);
        break;
      case "PageDown":
        event.preventDefault();
        void selectByIndex(currentIndex < 0 ? 0 : currentIndex + pageSize);
        break;
      case "PageUp":
        event.preventDefault();
        void selectByIndex(currentIndex < 0 ? 0 : currentIndex - pageSize);
        break;
      case "Home":
        event.preventDefault();
        void selectByIndex(0);
        break;
      case "End":
        event.preventDefault();
        void selectByIndex(assets.length - 1);
        break;
      default:
        break;
    }
  }

  return (
    <aside className="asset-browser" data-surface-region="primary-sidebar">
      <div className="asset-browser__header">
        <div>
          <span className="eyebrow">{mode === "review" ? "Review Queue" : "Dataset"}</span>
          <strong>{total} 张图片</strong>
        </div>
        <div className="asset-browser__header-actions">
          <button
            type="button"
            className="asset-browser__history"
            title="素材删除与恢复记录"
            aria-label="素材删除与恢复记录"
            onClick={onOpenDeletionHistory}
          >
            <History size={14} />
          </button>
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
      </div>

      <AssetFolderTree
        projectId={projectId}
        folders={folders}
        selectedPath={selectedFolderPath}
        loading={foldersLoading}
        onSelect={onFolderSelect}
      />

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
          const count = value ? (statusCounts[value] ?? 0) : (statusCounts.all ?? total);
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
        <div className="asset-selection-toolbar__summary">
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
          <span
            className="asset-selection-toolbar__hint"
            title="按住 Shift 点击可连续选择或取消；方向键切换图片，Ctrl+A 全选当前筛选"
          >
            Shift 连选
          </span>
        </div>
        <div className="asset-selection-toolbar__actions">
          <button
            type="button"
            disabled={!checkedAssetIds.length || bulkActionPending}
            onClick={onEditCheckedTags}
          >
            <Tags size={13} />
            编辑 Tags
          </button>
          <button
            type="button"
            disabled={!checkedAssetIds.length || bulkActionPending}
            onClick={onReviewCheckedAnnotations}
          >
            <BadgeCheck size={13} />
            标记已复核
          </button>
          <button
            type="button"
            disabled={!checkedAssetIds.length || bulkActionPending}
            onClick={onDeleteCheckedAnnotations}
          >
            <Unlink size={13} />
            删标注
          </button>
          <button
            type="button"
            className="is-danger"
            disabled={!checkedAssetIds.length || bulkActionPending}
            onClick={onDeleteCheckedAssets}
          >
            <Trash2 size={13} />
            删素材
          </button>
        </div>
      </div>

      <div
        className="asset-list"
        ref={scrollRef}
        role="region"
        aria-label="素材列表，使用方向键切换图片"
        tabIndex={0}
        onKeyDown={handleListKeyDown}
      >
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
                <div
                  key={asset.id}
                  className={`asset-row ${asset.id === selectedAssetId ? "is-selected" : ""}`}
                  style={{ transform: `translateY(${virtualRow.start}px)` }}
                >
                  <button
                    type="button"
                    className={`asset-check ${checkedAssetIdSet.has(asset.id) ? "is-checked" : ""}`}
                    role="checkbox"
                    aria-label={`选择 ${asset.filename}`}
                    aria-checked={checkedAssetIdSet.has(asset.id)}
                    onClick={(event) => {
                      toggleChecked(asset.id, event.shiftKey);
                    }}
                  >
                    {checkedAssetIdSet.has(asset.id) ? "✓" : ""}
                  </button>
                  <button
                    type="button"
                    className="asset-row__open"
                    onClick={(event) => void handleRowClick(asset.id, event.shiftKey)}
                  >
                    <img
                      src={thumbnailUrl(projectId, asset.id, asset.content_version, 160)}
                      alt=""
                      loading="lazy"
                    />
                    <span className="asset-row__copy">
                      <strong title={asset.filename}>{asset.filename}</strong>
                      <small>
                        {asset.width} × {asset.height} · {formatBytes(asset.byte_size, "KB")}
                        <span className="asset-row__channels" aria-label="标注通道状态">
                          {Object.entries(asset.annotation_channels ?? {})
                            .filter(([, status]) => status !== "missing")
                            .map(([channel, status]) => ({
                              channel,
                              status,
                              ...channelBadge(channel),
                            }))
                            .sort(
                              (left, right) =>
                                left.priority - right.priority ||
                                left.channel.localeCompare(right.channel),
                            )
                            .map(({ channel, status, shortLabel, label }) => {
                              return (
                                <i
                                  key={channel}
                                  className={`is-${status}`}
                                  title={`${label}：${channelStatusLabels[status] ?? status}`}
                                >
                                  {shortLabel}
                                </i>
                              );
                            })}
                        </span>
                      </small>
                      <span title={asset.relative_path}>{asset.relative_path}</span>
                    </span>
                    <StatusDot
                      status={asset.generation_status ?? asset.annotation_status}
                      showLabel={asset.generation_status === "failed"}
                      title={
                        asset.generation_status === "failed"
                          ? `生成失败${asset.generation_error ? `：${asset.generation_error}` : ""}`
                          : undefined
                      }
                    />
                  </button>
                </div>
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
