import { Eye, ImageDown, Play } from "lucide-react";

import type { PreprocessPreview } from "../../../shared/api/types";
import { Button } from "../../../shared/ui/Button";
import { Spinner } from "../../../shared/ui/Spinner";
import type { PreprocessFormState } from "../types";

interface Props {
  form: PreprocessFormState;
  onChange: (update: Partial<PreprocessFormState>) => void;
  assetCount: number;
  checkedCount: number;
  preview: PreprocessPreview | undefined;
  previewPending: boolean;
  executePending: boolean;
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
  executePending,
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
  return (
    <aside className="preprocess-settings">
      <header>
        <span className="preprocess-icon">
          <ImageDown size={18} />
        </span>
        <div>
          <span className="eyebrow">Reversible pipeline</span>
          <h2>图片预处理</h2>
        </div>
      </header>
      <div className="job-scope">
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
        <label className="check-line">
          <input
            type="checkbox"
            checked={form.allowUpscale}
            disabled={!form.resizeEnabled}
            onChange={(event) => onChange({ allowUpscale: event.target.checked })}
          />
          允许放大小图
        </label>
        <small>始终保持比例，不裁切、不补边，使用高质量 Lanczos。</small>
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
        <span className="preprocess-option-title">图片处理并发</span>
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
          仅并行执行图片解码、Lanczos 缩放和重新编码；重命名、数据库写入与回滚仍按顺序执行。
          自动模式最多使用 8 个线程，并会根据图片尺寸降低并发。
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
          支持 {"{name}"}（原文件名）和 {"{index}"}（序号）；保留原目录和最终扩展名，并同步同名 .txt
          / .json。
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
