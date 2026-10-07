import { useEffect, useMemo, useRef, type KeyboardEvent } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { CheckCircle2, FileQuestion, CircleAlert, ListChecks, Search } from "lucide-react";

import { thumbnailUrl } from "../../../../src/features/assets/api";
import type { AssetBrowserPanelProps } from "./assetBrowserTypes";
import { formatBytes } from "../../../../src/shared/format/bytes";
import { Spinner } from "../../../shared/ui/Spinner";
import { StatusDot } from "../../../shared/ui/StatusDot";
import { assetFilters, reviewFilters } from "./assetBrowserFilters";
import { channelBadge, channelStatusLabels } from "./assetChannelBadges";
import { AssetFolderTree } from "./AssetFolderTree";

export function AssetBrowserPanel({
  mode,
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
  candidateScope,
  candidateActive,
  candidateCount,
  totalAssetCount,
  foldersLoading,
  recursive,
  hasMore,
  loading,
  loadingMore,
  selectAllPending,
  allMatchingSelected,
  error,
  onSearchChange,
  onStatusChange,
  onFolderSelect,
  onCandidateScopeChange,
  onSelect,
  onSetChecked,
  onToggleAll,
  onRecursiveChange,
  onLoadMore,
  actions,
  scopeControls,
  rowDetail,
  historyAction,
}: AssetBrowserPanelProps) {
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
  }, [candidateScope, mode, projectId, search, selectedFolderPath, statusFilter]);

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
    <aside
      data-testid="asset-browser-panel"
      className="asset-browser"
      data-surface-region="primary-sidebar"
    >
      <div className="asset-browser__header">
        <div>
          <span className="eyebrow">{mode === "review" ? "Review Queue" : "Dataset"}</span>
          <strong>{total} 张图片</strong>
          <div className="asset-candidate-scope" role="group" aria-label="素材范围">
            <button
              type="button"
              className={candidateScope === "auto" ? "is-active" : ""}
              title={
                candidateActive
                  ? "候选集存在时，素材页与后续流程默认只使用候选图片"
                  : "候选集为空，当前自动使用项目内全部图片"
              }
              onClick={() => void onCandidateScopeChange("auto")}
            >
              <ListChecks size={12} />
              {candidateActive ? `候选 ${candidateCount}` : `自动范围 ${totalAssetCount}`}
            </button>
            {candidateActive ? (
              <button
                type="button"
                className={candidateScope === "all" ? "is-active" : ""}
                title="临时查看项目内全部素材；不会改变候选集"
                onClick={() => void onCandidateScopeChange("all")}
              >
                全部 {totalAssetCount}
              </button>
            ) : null}
          </div>
        </div>
        <div className="asset-browser__header-actions">
          {historyAction}
          <label
            className="switch-label"
            title="扫描所有子文件夹"
            data-testid="asset-browser-recursive-toggle"
          >
            <input
              type="checkbox"
              data-testid="asset-browser-recursive"
              checked={recursive}
              onChange={(event) => onRecursiveChange(event.target.checked)}
            />
            <span />
            递归
          </label>
        </div>
      </div>

      {scopeControls}
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
          data-testid="asset-browser-search"
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
              data-testid={`asset-filter-${value ?? "all"}`}
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
            data-testid="asset-browser-toggle-all"
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
        <div className="asset-selection-toolbar__actions">{actions}</div>
      </div>

      <div
        data-testid="asset-browser-list"
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
                    data-testid={`asset-check-${asset.id}`}
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
                    data-testid={`asset-open-${asset.id}`}
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
                        {asset.is_candidate ? (
                          <i className="asset-row__candidate" title="已加入持久候选集">
                            候选
                          </i>
                        ) : null}
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
                      <span title={asset.relative_path}>
                        {rowDetail ? rowDetail(asset) : asset.relative_path}
                      </span>
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
