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
  const validRequest = (form.resizeEnabled || form.convertEnabled) && validScope;
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
            <span>质量</span>
            <input
              type="number"
              min="1"
              max="100"
              value={form.quality}
              disabled={!form.convertEnabled}
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
          disabled={!preview?.changed_count || Boolean(preview.warning_count) || executePending}
          onClick={onExecute}
        >
          应用处理
        </Button>
      </div>
    </aside>
  );
}
