import { Eye, ImageDown, Play } from "lucide-react";

import type {
  ImageProcessingBackends,
  PreprocessExecutionPlan,
  PreprocessPreview,
} from "../../../../src/shared/api/types";
import { formatBytes } from "../../../../src/shared/format/bytes";
import { Button } from "../../../shared/ui/Button";
import { Spinner } from "../../../shared/ui/Spinner";
import type { PreprocessFormState } from "../../../../src/application/preprocessing/preprocessState";

const resizeAlgorithmDescriptions: Record<PreprocessFormState["resizeAlgorithm"], string> = {
  lanczos3: "Lanczos 3 保留较多细节，作为锐利默认值。",
  lanczos4: "Lanczos 4 使用更宽的采样邻域，通常更锐利，也可能产生更明显的边缘振铃。",
  anime_low_halo: "缩小达到 2 倍时使用 BOX，否则使用 Hamming，减少线稿和平涂边缘光晕。",
};

interface Props {
  form: PreprocessFormState;
  onChange: (update: Partial<PreprocessFormState>) => void;
  assetCount: number;
  checkedCount: number;
  preview: PreprocessPreview | undefined;
  previewPending: boolean;
  executePending: boolean;
  error: string | null;
  backends: ImageProcessingBackends | undefined;
  backendsPending: boolean;
  executionPlan: PreprocessExecutionPlan | undefined;
  executionPlanPending: boolean;
  onPreview: () => void;
  onExecute: () => void;
}

export function PreprocessSettingsPanel({
  form,
  onChange,
  assetCount,
  checkedCount,
  preview,
  previewPending,
  executePending,
  error,
  backends,
  backendsPending,
  executionPlan,
  executionPlanPending,
  onPreview,
  onExecute,
}: Props) {
  const validScope = form.scope === "all" || checkedCount > 0;
  const validRename =
    !form.renameEnabled ||
    (Boolean(form.renameTemplate.trim()) &&
      form.renameStartIndex >= 0 &&
      form.renamePadding >= 1 &&
      form.renamePadding <= 12);
  const imageRenderingEnabled = form.resizeEnabled || form.convertEnabled;
  const validConcurrency =
    !imageRenderingEnabled ||
    form.concurrencyMode === "auto" ||
    (Number.isInteger(form.maxWorkers) && form.maxWorkers >= 1 && form.maxWorkers <= 16);
  const validBatch =
    !imageRenderingEnabled ||
    form.executionMode === "cpu_only" ||
    form.batchMode === "auto" ||
    (Number.isInteger(form.batchSize) && form.batchSize >= 1 && form.batchSize <= 256);
  const usableAccelerators =
    backends?.backends.filter(
      (backend) => backend.id !== "cpu" && backend.status !== "unavailable",
    ) ?? [];
  const unavailableAccelerators =
    backends?.backends.filter(
      (backend) => backend.id !== "cpu" && backend.status === "unavailable",
    ) ?? [];
  const selectedAccelerator =
    usableAccelerators.find((backend) => backend.id === form.acceleratorId) ??
    usableAccelerators[0];
  const selectedPlanBackend = backends?.backends.find(
    (backend) => backend.id === executionPlan?.selected_backend_id,
  );
  const validRequest =
    (imageRenderingEnabled || form.renameEnabled) &&
    validScope &&
    validRename &&
    validConcurrency &&
    validBatch;
  return (
    <aside className="preprocess-settings" data-surface-region="primary-sidebar">
      <header>
        <span className="preprocess-icon">
          <ImageDown size={18} />
        </span>
        <div>
          <span className="eyebrow">Reversible pipeline</span>
          <h2>图片预处理</h2>
        </div>
      </header>
      <div className="scope-selector">
        <span>处理范围</span>
        <button
          className={form.scope === "all" ? "is-active" : ""}
          onClick={() => onChange({ scope: "all" })}
        >
          当前项目<small>{assetCount} 张</small>
        </button>
        <button
          className={form.scope === "selected" ? "is-active" : ""}
          onClick={() => onChange({ scope: "selected" })}
        >
          工作台选中<small>{checkedCount} 张</small>
        </button>
      </div>
      <section className="preprocess-option">
        <label className="option-toggle">
          <input
            type="checkbox"
            checked={form.resizeEnabled}
            onChange={(event) => onChange({ resizeEnabled: event.target.checked })}
          />
          <span />
          限制最长边
        </label>
        <label className="form-field">
          <span>最长边像素</span>
          <input
            type="number"
            min="64"
            value={form.maxEdge}
            disabled={!form.resizeEnabled}
            onChange={(event) => onChange({ maxEdge: Number(event.target.value) })}
          />
        </label>
        <label className="form-field">
          <span>缩放算法</span>
          <select
            value={form.resizeAlgorithm}
            disabled={!form.resizeEnabled}
            onChange={(event) =>
              onChange({
                resizeAlgorithm: event.target.value as PreprocessFormState["resizeAlgorithm"],
              })
            }
          >
            <option value="lanczos3">Lanczos 3（锐利，默认）</option>
            <option value="lanczos4">Lanczos 4（更锐利）</option>
            <option value="anime_low_halo">二次元低光晕（自适应）</option>
          </select>
        </label>
        <label className="check-line">
          <input
            type="checkbox"
            checked={form.allowUpscale}
            disabled={!form.resizeEnabled}
            onChange={(event) => onChange({ allowUpscale: event.target.checked })}
          />
          允许放大小图
        </label>
        <small>
          始终保持比例，不裁切、不补边。{resizeAlgorithmDescriptions[form.resizeAlgorithm]}
          索引色和 1 位图会先转换为 RGB/RGBA。
        </small>
      </section>
      <section className="preprocess-option">
        <label className="option-toggle">
          <input
            type="checkbox"
            checked={form.convertEnabled}
            onChange={(event) => onChange({ convertEnabled: event.target.checked })}
          />
          <span />
          转换图片格式
        </label>
        <div className="preprocess-inline-fields">
          <label className="form-field">
            <span>格式</span>
            <select
              value={form.format}
              disabled={!form.convertEnabled}
              onChange={(event) =>
                onChange({ format: event.target.value as PreprocessFormState["format"] })
              }
            >
              <option value="webp">WebP</option>
              <option value="jpeg">JPEG</option>
              <option value="png">PNG</option>
            </select>
          </label>
          <label className="form-field">
            <span>质量（WebP / JPEG）</span>
            <input
              type="number"
              min="1"
              max="100"
              value={form.quality}
              disabled={!form.convertEnabled || form.format === "png"}
              onChange={(event) => onChange({ quality: Number(event.target.value) })}
            />
          </label>
        </div>
        <label className="effort-slider">
          <span>
            WebP 压缩努力程度 <strong>{form.effort}</strong>
          </span>
          <input
            type="range"
            min="0"
            max="6"
            value={form.effort}
            disabled={!form.convertEnabled || form.format !== "webp"}
            onChange={(event) => onChange({ effort: Number(event.target.value) })}
          />
        </label>
      </section>
      <section className="preprocess-option">
        <span className="preprocess-option-title">执行引擎</span>
        <div className="preprocess-engine-selector" role="group" aria-label="图片执行引擎">
          <button
            type="button"
            className={form.executionMode === "auto" ? "is-active" : ""}
            disabled={!imageRenderingEnabled}
            onClick={() => onChange({ executionMode: "auto" })}
          >
            自动选择
          </button>
          <button
            type="button"
            className={form.executionMode === "cpu_only" ? "is-active" : ""}
            disabled={!imageRenderingEnabled}
            onClick={() => onChange({ executionMode: "cpu_only" })}
          >
            仅 CPU
          </button>
          <button
            type="button"
            className={form.executionMode === "prefer_accelerator" ? "is-active" : ""}
            disabled={!imageRenderingEnabled || usableAccelerators.length === 0}
            onClick={() =>
              onChange({
                executionMode: "prefer_accelerator",
                acceleratorId: selectedAccelerator?.id ?? "",
              })
            }
          >
            硬件加速
          </button>
        </div>
        {form.executionMode === "prefer_accelerator" ? (
          <>
            <label className="form-field preprocess-accelerator-field">
              <span>加速设备</span>
              <select
                value={selectedAccelerator?.id ?? ""}
                disabled={!imageRenderingEnabled || usableAccelerators.length === 0}
                onChange={(event) => onChange({ acceleratorId: event.target.value })}
              >
                {usableAccelerators.map((backend) => (
                  <option key={backend.id} value={backend.id}>
                    {backend.label}
                    {backend.status === "degraded" ? "（部分能力）" : ""}
                  </option>
                ))}
              </select>
            </label>
            {selectedAccelerator ? (
              <small className="preprocess-capability-summary">
                {selectedAccelerator.total_memory_bytes
                  ? `${formatBytes(selectedAccelerator.total_memory_bytes)} 显存 · `
                  : ""}
                {selectedAccelerator.decode_formats.includes("jpeg") &&
                selectedAccelerator.encode_formats.includes("jpeg")
                  ? "JPEG 编解码 + "
                  : ""}
                {selectedAccelerator.resize_algorithms.length
                  ? `${selectedAccelerator.resize_algorithms
                      .map((algorithm) => algorithm.replace("lanczos", "Lanczos "))
                      .join(" / ")} 缩放`
                  : "无可用缩放能力"}
              </small>
            ) : null}
          </>
        ) : null}
        <div
          className={`preprocess-engine-status ${
            usableAccelerators.length ? "is-ready" : "is-cpu-only"
          }`}
        >
          {backendsPending ? (
            <span>正在探测图片处理后端…</span>
          ) : executionPlanPending ? (
            <span>正在评估当前图片的执行路线…</span>
          ) : executionPlan ? (
            <>
              <strong>{selectedPlanBackend?.label ?? executionPlan.selected_backend_id}</strong>
              <span>
                {executionPlan.route_counts.accelerated_full ?? 0} 加速管线 ·{" "}
                {executionPlan.route_counts.accelerated_resize ?? 0} 加速缩放 ·{" "}
                {executionPlan.route_counts.cpu ?? 0} CPU
              </span>
              {selectedPlanBackend?.issue ? <small>{selectedPlanBackend.issue}</small> : null}
            </>
          ) : usableAccelerators.length ? (
            <>
              <span>检测到 {usableAccelerators.length} 个可用加速设备；生成预览后评估路线。</span>
              {selectedAccelerator?.issue ? <small>{selectedAccelerator.issue}</small> : null}
            </>
          ) : (
            <span>
              当前仅使用 CPU。
              {unavailableAccelerators[0]?.issue ? ` ${unavailableAccelerators[0].issue}` : ""}
            </span>
          )}
        </div>
        <details className="preprocess-advanced-execution">
          <summary>高级执行参数</summary>
          <div className="preprocess-inline-fields preprocess-concurrency-fields">
            <label className="form-field">
              <span>CPU 线程</span>
              <select
                value={form.concurrencyMode}
                disabled={!imageRenderingEnabled}
                onChange={(event) =>
                  onChange({
                    concurrencyMode: event.target.value as PreprocessFormState["concurrencyMode"],
                  })
                }
              >
                <option value="auto">自动（推荐）</option>
                <option value="manual">手动</option>
              </select>
            </label>
            <label className="form-field">
              <span>最大线程数</span>
              <input
                type="number"
                min="1"
                max="16"
                value={form.maxWorkers}
                disabled={!imageRenderingEnabled || form.concurrencyMode !== "manual"}
                onChange={(event) => onChange({ maxWorkers: Number(event.target.value) })}
              />
            </label>
            <label className="form-field">
              <span>加速批大小</span>
              <select
                value={form.batchMode}
                disabled={!imageRenderingEnabled || form.executionMode === "cpu_only"}
                onChange={(event) =>
                  onChange({
                    batchMode: event.target.value as PreprocessFormState["batchMode"],
                  })
                }
              >
                <option value="auto">自动（推荐）</option>
                <option value="manual">手动</option>
              </select>
            </label>
            <label className="form-field">
              <span>每批图片数</span>
              <input
                type="number"
                min="1"
                max="256"
                value={form.batchSize}
                disabled={
                  !imageRenderingEnabled ||
                  form.executionMode === "cpu_only" ||
                  form.batchMode !== "manual"
                }
                onChange={(event) => onChange({ batchSize: Number(event.target.value) })}
              />
            </label>
          </div>
        </details>
        <small>
          自动模式按格式、图片模式、规模和运行时能力逐项选择；不支持的图片安全回退 CPU。
          最终替换、旁车、数据库写入与回滚仍按顺序执行。不同执行引擎可能产生轻微像素或压缩差异；
          需要跨设备保持最稳定结果时请选择仅 CPU。
        </small>
      </section>
      <section className="preprocess-option">
        <label className="option-toggle">
          <input
            type="checkbox"
            checked={form.renameEnabled}
            onChange={(event) => onChange({ renameEnabled: event.target.checked })}
          />
          <span />
          批量重命名
        </label>
        <label className="form-field">
          <span>文件名模板（不含扩展名）</span>
          <input
            value={form.renameTemplate}
            maxLength={200}
            disabled={!form.renameEnabled}
            placeholder="image_{index}"
            onChange={(event) => onChange({ renameTemplate: event.target.value })}
          />
        </label>
        <div className="preprocess-inline-fields preprocess-rename-fields">
          <label className="form-field">
            <span>起始序号</span>
            <input
              type="number"
              min="0"
              max="9999999999"
              value={form.renameStartIndex}
              disabled={!form.renameEnabled}
              onChange={(event) => onChange({ renameStartIndex: Number(event.target.value) })}
            />
          </label>
          <label className="form-field">
            <span>补零位数</span>
            <input
              type="number"
              min="1"
              max="12"
              value={form.renamePadding}
              disabled={!form.renameEnabled}
              onChange={(event) => onChange({ renamePadding: Number(event.target.value) })}
            />
          </label>
        </div>
        <small>
          支持 {"{name}"}（原文件名）和 {"{index}"}（序号）；保留原目录和最终扩展名，并同步原标注
          .txt、各语言译文与 .json。
        </small>
      </section>
      {error ? <p className="form-error">{error}</p> : null}
      <div className="preprocess-actions">
        <Button
          icon={previewPending ? <Spinner /> : <Eye size={14} />}
          disabled={!validRequest || previewPending}
          onClick={onPreview}
        >
          预览改动
        </Button>
        <Button
          tone="primary"
          icon={executePending ? <Spinner /> : <Play size={14} />}
          disabled={
            !validRequest ||
            !preview?.changed_count ||
            Boolean(preview.warning_count) ||
            executePending
          }
          onClick={onExecute}
        >
          应用处理
        </Button>
      </div>
    </aside>
  );
}
