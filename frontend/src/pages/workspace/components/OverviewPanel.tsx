import { Trash2 } from "lucide-react";

import { useTagFrequency } from "../../../features/statistics/hooks";
import type { AssetSummary, WorkspaceSummary } from "../../../shared/api/types";
import { Button } from "../../../shared/ui/Button";
import "../styles/statistics.css";

interface OverviewPanelProps {
  projectId: string;
  workspace: WorkspaceSummary;
  asset: AssetSummary | null;
  onDeleteAsset: (assetId: string) => void;
}

export function OverviewPanel({ projectId, workspace, asset, onDeleteAsset }: OverviewPanelProps) {
  const statistics = useTagFrequency(projectId);
  const progress = workspace.asset_count
    ? Math.round((workspace.annotated_count / workspace.asset_count) * 100)
    : 0;
  const buckets = statistics.data?.buckets.slice(0, 8) ?? [];
  const maximum = buckets[0]?.count ?? 1;

  return (
    <>
      <section className="inspector-section">
        <span className="section-kicker">当前数据集</span>
        <div className="dataset-progress">
          <div
            className="progress-ring"
            style={{ "--progress": `${progress * 3.6}deg` } as React.CSSProperties}
          >
            <span>{progress}%</span>
          </div>
          <div>
            <strong>
              {workspace.annotated_count} / {workspace.asset_count}
            </strong>
            <span>图片已有同名标注</span>
            <small>{workspace.invalid_count} 个异常项</small>
          </div>
        </div>
        <div className="progress-track">
          <span style={{ width: `${progress}%` }} />
        </div>
      </section>

      <section className="inspector-section">
        <span className="section-kicker">标记结构 · 只读统计</span>
        {buckets.length ? (
          <div className="tag-frequency">
            {buckets.map((bucket) => (
              <div className="tag-frequency__row" key={bucket.value}>
                <div>
                  <code>&lt;{bucket.value}&gt;</code>
                  <span>{bucket.count}</span>
                </div>
                <i style={{ width: `${Math.max(4, (bucket.count / maximum) * 100)}%` }} />
              </div>
            ))}
            <small>
              {statistics.data?.document_count ?? 0} 份标注 · 共识别
              {statistics.data?.occurrence_count ?? 0} 个开始标签
            </small>
          </div>
        ) : (
          <p className="quiet-copy">当前标注中还没有可统计的标签结构。</p>
        )}
      </section>

      <section className="inspector-section">
        <span className="section-kicker">当前图片</span>
        {asset ? (
          <dl className="detail-list">
            <div>
              <dt>文件名</dt>
              <dd title={asset.filename}>{asset.filename}</dd>
            </div>
            <div>
              <dt>尺寸</dt>
              <dd>
                {asset.width} × {asset.height}
              </dd>
            </div>
            <div>
              <dt>格式</dt>
              <dd>{asset.suffix.slice(1).toUpperCase()}</dd>
            </div>
            <div>
              <dt>标注</dt>
              <dd>{asset.annotation_relative_path}</dd>
            </div>
            <div>
              <dt>JSON</dt>
              <dd>{asset.metadata_relative_path ?? "无"}</dd>
            </div>
          </dl>
        ) : (
          <p className="quiet-copy">选择图片后显示文件详情。</p>
        )}
        {asset ? (
          <Button
            className="inspector-delete-asset"
            tone="danger"
            icon={<Trash2 size={13} />}
            onClick={() => onDeleteAsset(asset.id)}
          >
            删除当前素材
          </Button>
        ) : null}
      </section>

      <section className="inspector-section inspector-section--path">
        <span className="section-kicker">项目位置</span>
        <p title={workspace.root_path}>{workspace.root_path}</p>
      </section>
    </>
  );
}
