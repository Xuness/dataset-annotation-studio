import { Cpu, Eye, Gauge } from "lucide-react";

import type {
  PreprocessExecutionPlan,
  PreprocessPreview,
  PreprocessRoute,
} from "../../../../src/shared/api/types";

const routeLabels: Record<PreprocessRoute, string> = {
  accelerated_full: "加速管线",
  accelerated_resize: "加速缩放",
  cpu: "CPU",
};

const reasonLabels: Record<string, string> = {
  accelerator_unavailable: "所选加速器当前不可用",
  accelerator_initialization_failed: "加速器初始化失败，当前操作使用 CPU",
  workload_too_small: "当前任务规模较小，自动选择 CPU",
  animated_image: "多帧图片仅支持 CPU",
  unsupported_bit_depth: "当前位深仅支持 CPU",
  progressive_jpeg: "渐进式 JPEG 暂时使用 CPU",
  unsupported_resize_algorithm: "所选缩放算法仅支持 CPU",
  unsupported_image_mode: "当前图片模式仅支持 CPU",
  no_accelerated_stage: "当前操作没有可加速阶段",
  unsupported_codec_route: "当前编解码组合仅支持 CPU",
  cuda_codec_unavailable: "JPEG 加速编解码不可用，当前操作使用 CPU",
  cuda_out_of_memory: "加速器显存不足，已回退 CPU",
  cuda_render_failed: "加速器执行失败，已回退 CPU",
  cuda_resize_failed: "加速缩放失败，已回退 CPU",
};

export function PreprocessPreviewPanel({
  preview,
  executionPlan,
  executionPlanPending,
  executionPlanError,
}: {
  preview: PreprocessPreview | undefined;
  executionPlan: PreprocessExecutionPlan | undefined;
  executionPlanPending: boolean;
  executionPlanError: string | null;
}) {
  const routes = new Map(executionPlan?.items.map((item) => [item.asset_id, item] as const) ?? []);
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
      {preview ? (
        <div className="preprocess-route-summary">
          <Gauge size={15} aria-hidden="true" />
          {executionPlanPending ? (
            <span>正在按当前设备与图片能力评估预计路线…</span>
          ) : executionPlan ? (
            <>
              <span>
                预计 <strong>{executionPlan.route_counts.accelerated_full ?? 0}</strong> 加速管线
              </span>
              <span>
                <strong>{executionPlan.route_counts.accelerated_resize ?? 0}</strong> 加速缩放
              </span>
              <span>
                <strong>{executionPlan.route_counts.cpu ?? 0}</strong> CPU
              </span>
              <small>
                CPU {executionPlan.effective_cpu_workers} 线程 · 加速批大小{" "}
                {executionPlan.effective_batch_size}
              </small>
            </>
          ) : executionPlanError ? (
            <span className="form-error">执行路线评估失败：{executionPlanError}</span>
          ) : (
            <span>执行路线会在预览生成后评估。</span>
          )}
        </div>
      ) : null}
      <div className="preview-table">
        {preview?.truncated ? (
          <p className="preview-limit-note">
            当前展示 {preview.items.length} / {preview.total_items} 项；执行校验仍覆盖全部图片。
          </p>
        ) : null}
        {preview?.items.map((item) => {
          const route = routes.get(item.asset_id);
          const reason = route?.reason_code
            ? (reasonLabels[route.reason_code] ?? route.reason_code)
            : undefined;
          return (
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
              {route ? (
                <span
                  className={`preprocess-route-chip preprocess-route-chip--${route.route}`}
                  title={reason ?? `预计使用 ${route.backend_id}`}
                >
                  {route.route === "cpu" ? <Cpu size={11} /> : <Gauge size={11} />}
                  {routeLabels[route.route]}
                </span>
              ) : (
                <span className="preprocess-route-chip is-muted">—</span>
              )}
              {item.warning ? <small>{item.warning}</small> : null}
            </div>
          );
        })}
        {!preview ? (
          <div className="preview-empty">
            <Eye size={24} />
            <p>调整参数后先生成预览；应用前不会改动任何文件。</p>
          </div>
        ) : null}
      </div>
    </section>
  );
}
