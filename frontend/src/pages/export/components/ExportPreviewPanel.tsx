import { CheckCircle2, FileWarning, ScanSearch } from "lucide-react";

import type { ExportPreview } from "../../../shared/api/types";
import { formatBytes } from "../../../shared/format/bytes";

const statusLabels: Record<string, string> = {
  confirmed: "已确认",
  unreviewed: "待确认",
  stale: "已过期",
  missing: "通道缺失",
  empty: "内容为空",
  invalid: "结构异常",
  encoding_error: "编码异常",
};

export function ExportPreviewPanel({ preview }: { preview: ExportPreview | undefined }) {
  return (
    <section className="export-preview workspace-scene-surface" data-surface-region="content">
      <header>
        <div>
          <span className="eyebrow">Preflight validation</span>
          <h2>导出校验</h2>
        </div>
        {preview ? (
          <div className="export-preview__summary">
            <span>
              <strong>{preview.total_items}</strong> 张图片
            </span>
            <span>
              <strong>{preview.warning_count}</strong> 个警告
            </span>
            <span>
              <strong>{formatBytes(preview.image_bytes + preview.annotation_bytes)}</strong>
            </span>
          </div>
        ) : null}
      </header>

      {preview ? (
        <div className="export-status-strip">
          <span>已确认 {preview.valid_count}</span>
          <span>待确认 {preview.unreviewed_count}</span>
          <span>已过期 {preview.stale_count}</span>
          <span>通道缺失 {preview.missing_count}</span>
          <span>内容为空 {preview.empty_count}</span>
          <span>结构异常 {preview.invalid_count}</span>
          <span>编码异常 {preview.encoding_error_count}</span>
        </div>
      ) : null}

      <div className="export-preview-table">
        {preview?.blocking_issues.map((issue) => (
          <p className="export-global-error" key={issue}>
            <FileWarning size={14} /> {issue}
          </p>
        ))}
        {preview?.truncated ? (
          <p className="preview-limit-note">
            当前展示 {preview.items.length} / {preview.total_items} 项；执行校验覆盖全部图片。
          </p>
        ) : null}
        {preview?.items.map((item) => {
          const issue = item.blocking_issue ?? item.warning_message;
          return (
            <div
              key={item.asset_id}
              className={
                item.blocking_issue ? "has-error" : item.warning_code ? "has-warning" : "is-valid"
              }
            >
              <span title={item.source_relative_path}>{item.source_relative_path}</span>
              <span title={item.target_outputs.join("\n")}>
                {item.target_outputs.length} 个输出
              </span>
              <span>{statusLabels[item.annotation_status] ?? item.annotation_status}</span>
              <span
                title={Object.entries(item.channel_statuses)
                  .map(([channel, status]) => `${channel}: ${status}`)
                  .join("\n")}
              >
                {Object.values(item.channel_statuses)
                  .map((status) => statusLabels[status] ?? status)
                  .join(" / ")}
              </span>
              {issue ? <small>{issue}</small> : null}
            </div>
          );
        })}
        {!preview ? (
          <div className="export-preview-empty">
            <ScanSearch size={25} />
            <p>选择范围和空目录后进行校验；校验不会写入任何导出文件。</p>
          </div>
        ) : preview.blocking_issue_count === 0 && preview.warning_count === 0 ? (
          <div className="export-preview-success">
            <CheckCircle2 size={16} />
            当前范围可以直接导出。
          </div>
        ) : null}
      </div>
    </section>
  );
}
