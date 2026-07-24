import { Clock3, Cpu, Eye, ImageDown, Play } from "lucide-react";

import type { PreprocessExecutionRuntimeInfo, PreprocessPreview } from "../../../shared/api/types";
import { Button } from "../../../shared/ui/Button";
import { Spinner } from "../../../shared/ui/Spinner";
import { formatByteSize, formatElapsed, formatPreviewDuration } from "../runtimeFeedback";
import type { PreprocessFormState } from "../types";

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
  previewElapsedMs: number;
  executePending: boolean;
  executeElapsedMs: number;
  lastExecutionRuntime: PreprocessExecutionRuntimeInfo | null | undefined;
  error: string | null;
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
  previewElapsedMs,
  executePending,
  executeElapsedMs,
  lastExecutionRuntime,
  error,
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
  const validRequest =
    (imageRenderingEnabled || form.renameEnabled) && validScope && validRename && validConcurrency;
  const runtimeLabel = preview
    ? `解码 ${preview.runtime.decode_device.toUpperCase()} · 缩放 ${preview.runtime.resize_device.toUpperCase()} · 编码 ${preview.runtime.encoding_device.toUpperCase()}`
    : "解码 CPU · 缩放 CPU · 编码 CPU";
  const selectedWorkerCount = preview
    ? form.concurrencyMode === "auto"
      ? preview.runtime.automatic_worker_count
      : Math.min(form.maxWorkers, preview.runtime.maximum_worker_count)
    : null;
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
      <section className="preprocess-runtime-card" aria-label="预处理运行信息">
        <div className="preprocess-runtime-card__title">
          <Cpu size={15} />
          <strong>
            {preview?.runtime.device === "cuda"
              ? "CUDA 全 GPU 预处理"
              : preview?.runtime.device === "mixed"
                ? "CUDA / CPU 混合预处理"
                : "CPU 本地处理"}
          </strong>
          <span>{runtimeLabel}</span>
        </div>
        <p>
          预览只检查图片信息、文件状态和目标尺寸，不会真正缩放或编码。CUDA 模式会尽量让解码、
          Lanczos 缩放和编码都停留在 GPU；不支持的算法、格式或运行时故障会自动回退 CPU。
        </p>
        <dl>
          <div>
            <dt>预览状态</dt>
            <dd>
              {previewPending ? (
                <>
                  <Clock3 size={12} /> 已用时 {formatElapsed(previewElapsedMs)}
                </>
              ) : preview ? (
                `完成于 ${formatPreviewDuration(preview.runtime.preview_duration_ms)}`
              ) : (
                "尚未运行"
              )}
            </dd>
          </div>
          <div>
            <dt>处理路径</dt>
            <dd>
              {preview
                ? runtimeLabel
                : form.processingDevice === "cpu"
                  ? "缩放 CPU · 编码 CPU"
                  : "等待预览检测 CUDA"}
            </dd>
          </div>
          <div>
            <dt>实际处理</dt>
            <dd>
              {executeElapsedMs > 0
                ? `${preview?.runtime.device === "cuda" ? "CUDA 全 GPU" : preview?.runtime.device === "mixed" ? "CUDA / CPU 混合" : "CPU"} 处理中 · ${runtimeLabel} · 已用时 ${formatElapsed(executeElapsedMs)}`
                : lastExecutionRuntime
                  ? `完成于 ${formatPreviewDuration(lastExecutionRuntime.duration_ms)} · ${lastExecutionRuntime.worker_count} 线程`
                  : selectedWorkerCount
                    ? `${selectedWorkerCount} 个工作线程 · ${preview?.runtime.render_count ?? 0} 张需渲染`
                    : form.concurrencyMode === "auto"
                      ? "自动并发，最多 8 线程"
                      : `最多 ${form.maxWorkers} 线程`}
            </dd>
          </div>
          {preview ? (
            <div>
              <dt>输入规模</dt>
              <dd>{formatByteSize(preview.runtime.source_bytes)}</dd>
            </div>
          ) : null}
        </dl>
        {preview?.runtime.fallback_reason ? (
          <p className="preprocess-runtime-card__warning">{preview.runtime.fallback_reason}</p>
        ) : null}
        {lastExecutionRuntime?.fallback_reason ? (
          <p className="preprocess-runtime-card__warning">
            实际执行：{lastExecutionRuntime.fallback_reason}
          </p>
        ) : null}
        <small>
          GPU 适合大图批处理；小图可能因显存传输开销而不比 CPU 快。自动模式在 CUDA
          不可用、图片模式不支持或运行失败时会安全回退 CPU。
        </small>
      </section>
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
        <span className="preprocess-option-title">处理设备与并发</span>
        <label className="form-field">
          <span>缩放设备</span>
          <select
            value={form.processingDevice}
            disabled={!form.resizeEnabled}
            onChange={(event) =>
              onChange({
                processingDevice: event.target.value as PreprocessFormState["processingDevice"],
              })
            }
          >
            <option value="auto">自动（优先 CUDA）</option>
            <option value="cuda">CUDA（不可用时回退）</option>
            <option value="cpu">CPU</option>
          </select>
        </label>
        <div className="preprocess-inline-fields preprocess-concurrency-fields">
          <label className="form-field">
            <span>线程模式</span>
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
        </div>
        <small>
          CUDA 模式优先使用 nvImageCodec 完成 GPU 解码/编码，并使用 CuPy 完成 Lanczos 3/4 缩放；
          anime_low_halo、部分格式和异常情况会回退 CPU。重命名、数据库写入与回滚仍按顺序执行。
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
          {previewPending ? `预览中 ${formatElapsed(previewElapsedMs)}` : "预览改动"}
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
          {executeElapsedMs > 0 ? `处理中 ${formatElapsed(executeElapsedMs)}` : "应用处理"}
        </Button>
      </div>
    </aside>
  );
}
