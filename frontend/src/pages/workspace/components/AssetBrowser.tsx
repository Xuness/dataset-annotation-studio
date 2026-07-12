import { useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { CheckCircle2, CircleAlert, FileQuestion, Search } from "lucide-react";

import { thumbnailUrl } from "../../../features/assets/api";
import type { AnnotationStatus, AssetSummary } from "../../../shared/api/types";
import { StatusDot } from "../../../shared/ui/StatusDot";

type StatusFilter = AnnotationStatus | null;

interface AssetBrowserProps {
  projectId: string;
  assets: AssetSummary[];
  total: number;
  selectedAssetId: string | null;
  checkedAssetIds: string[];
  search: string;
  statusFilter: StatusFilter;
  statusCounts: Record<string, number>;
  recursive: boolean;
  onSearchChange: (value: string) => void;
  onStatusChange: (value: StatusFilter) => void;
  onSelect: (assetId: string) => void;
  onToggleChecked: (assetId: string) => void;
  onRecursiveChange: (value: boolean) => void;
}

const filters: Array<{ value: StatusFilter; label: string; icon: typeof CheckCircle2 }> = [
  { value: null, label: "全部", icon: CheckCircle2 },
  { value: "missing", label: "未标注", icon: FileQuestion },
  { value: "invalid", label: "异常", icon: CircleAlert },
];

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function AssetBrowser({
  projectId,
  assets,
  total,
  selectedAssetId,
  checkedAssetIds,
  search,
  statusFilter,
  statusCounts,
  recursive,
  onSearchChange,
  onStatusChange,
  onSelect,
  onToggleChecked,
  onRecursiveChange,
}: AssetBrowserProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: assets.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 70,
    overscan: 8,
  });

  return (
    <aside className="asset-browser">
      <div className="asset-browser__header">
        <div>
          <span className="eyebrow">Dataset</span>
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

      <div className="asset-list" ref={scrollRef}>
        {assets.length ? (
          <div className="asset-list__virtual" style={{ height: virtualizer.getTotalSize() }}>
            {virtualizer.getVirtualItems().map((virtualRow) => {
              const asset = assets[virtualRow.index];
              return (
                <button
                  key={asset.id}
                  className={`asset-row ${asset.id === selectedAssetId ? "is-selected" : ""}`}
                  style={{ transform: `translateY(${virtualRow.start}px)` }}
                  onClick={() => onSelect(asset.id)}
                >
                  <span
                    className={`asset-check ${checkedAssetIds.includes(asset.id) ? "is-checked" : ""}`}
                    role="checkbox"
                    aria-checked={checkedAssetIds.includes(asset.id)}
                    tabIndex={0}
                    onClick={(event) => {
                      event.stopPropagation();
                      onToggleChecked(asset.id);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === " " || event.key === "Enter") {
                        event.preventDefault();
                        event.stopPropagation();
                        onToggleChecked(asset.id);
                      }
                    }}
                  >
                    {checkedAssetIds.includes(asset.id) ? "✓" : ""}
                  </span>
                  <img src={thumbnailUrl(projectId, asset.id, 160)} alt="" loading="lazy" />
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
            <FileQuestion size={22} />
            <p>没有符合当前条件的图片。</p>
          </div>
        )}
      </div>
    </aside>
  );
}
