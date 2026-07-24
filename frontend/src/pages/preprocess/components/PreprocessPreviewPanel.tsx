import { Clock3, Cpu, Eye } from "lucide-react";

import type { PreprocessPreview } from "../../../shared/api/types";
import { Spinner } from "../../../shared/ui/Spinner";
import { formatByteSize, formatElapsed, formatPreviewDuration } from "../runtimeFeedback";

interface Props {
  preview: PreprocessPreview | undefined;
  pending: boolean;
  elapsedMs: number;
}

export function PreprocessPreviewPanel({ preview, pending, elapsedMs }: Props) {
  return (
    <section className="preprocess-preview workspace-scene-surface" data-surface-region="content">
      <header>
        <div>
          <span className="eyebrow">Dry run</span>
          <h2>改动预览</h2>
        </div>
        {preview ? (
          <div>
            <strong>{preview.changed_count}</strong>
            <span>将修改</span>
            <strong>{preview.unchanged_count}</strong>
            <span>无需处理</span>
          </div>
        ) : null}
      </header>
      <div className="preview-table">
        {preview ? (
          <p className="preview-runtime-summary">
            <span>
              <Cpu size={13} /> CPU
            </span>
            <span>预览耗时 {formatPreviewDuration(preview.runtime.preview_duration_ms)}</span>
            <span>{preview.runtime.render_count} 张需要实际渲染</span>
            <span>输入 {formatByteSize(preview.runtime.source_bytes)}</span>
          </p>
        ) : null}
        {preview?.truncated ? (
          <p className="preview-limit-note">
            当前展示 {preview.items.length} / {preview.total_items} 项；执行校验仍覆盖全部图片。
          </p>
        ) : null}
        {preview?.items.map((item) => (
          <div
            key={item.asset_id}
            className={item.warning ? "has-warning" : item.will_change ? "will-change" : ""}
          >
            <span title={item.before_relative_path}>{item.before_relative_path}</span>
            <span>
              {item.before_width} × {item.before_height}
            </span>
            <span>→</span>
            <span title={item.after_relative_path}>{item.after_relative_path}</span>
            <span>
              {item.after_width} × {item.after_height}
            </span>
            {item.warning ? <small>{item.warning}</small> : null}
          </div>
        ))}
        {!preview ? (
          <div className="preview-empty">
            {pending ? <Spinner /> : <Eye size={24} />}
            <p>
              {pending
                ? `正在使用 CPU 检查图片和目标尺寸，已用时 ${formatElapsed(elapsedMs)}`
                : "调整参数后先生成预览；应用前不会改动任何文件。"}
            </p>
            {pending ? (
              <small>
                <Clock3 size={12} /> 该阶段不会缩放图片，也不会调用 GPU / CUDA。
              </small>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}
