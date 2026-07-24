import { Eye, FolderOpen, PackageOpen } from "lucide-react";

import type { AnnotationChannel, ExportFormat, ExportPreview } from "../../../shared/api/types";
import { Button } from "../../../shared/ui/Button";
import { Spinner } from "../../../shared/ui/Spinner";
import type { ExportFormState } from "../types";

interface Props {
  form: ExportFormState;
  assetCount: number;
  checkedCount: number;
  preview: ExportPreview | undefined;
  previewPending: boolean;
  exportPending: boolean;
  activeExport: boolean;
  error: string | null;
  onChange: (update: Partial<ExportFormState>) => void;
  onChooseFolder: () => void;
  onPreview: () => void;
  onExport: () => void;
}

export function ExportSettingsPanel({
  form,
  assetCount,
  checkedCount,
  preview,
  previewPending,
  exportPending,
  activeExport,
  error,
  onChange,
  onChooseFolder,
  onPreview,
  onExport,
}: Props) {
  const validScope = form.scope === "all" || checkedCount > 0;
  const readyToPreview = Boolean(
    form.destinationPath &&
    validScope &&
    form.channels.length &&
    form.formats.length &&
    !activeExport,
  );
  const readyToExport = Boolean(
    preview && !preview.blocking_issue_count && preview.total_items && !activeExport,
  );

  function toggleChannel(channel: AnnotationChannel) {
    onChange({
      channels: form.channels.includes(channel)
        ? form.channels.filter((value) => value !== channel)
        : [...form.channels, channel],
    });
  }

  function toggleFormat(format: ExportFormat) {
    onChange({
      formats: form.formats.includes(format)
        ? form.formats.filter((value) => value !== format)
        : [...form.formats, format],
    });
  }

  return (
    <aside className="export-settings" data-surface-region="primary-sidebar">
      <header>
        <span className="export-icon">
          <PackageOpen size={18} />
        </span>
        <div>
          <span className="eyebrow">Revision materializer</span>
          <h2>数据集导出</h2>
        </div>
      </header>

      <div className="scope-selector">
        <span>导出范围</span>
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

      <section className="export-option">
        <span className="export-option__title">标注通道</span>
        <div className="export-check-grid">
          {[
            ["existing_annotation", "原有标注"],
            ["tags", "Tags"],
            ["description", "LLM 描述"],
            ["translation", "翻译"],
          ].map(([channel, label]) => (
            <label key={channel}>
              <input
                type="checkbox"
                checked={form.channels.includes(channel as AnnotationChannel)}
                onChange={() => toggleChannel(channel as AnnotationChannel)}
              />
              <span>{label}</span>
            </label>
          ))}
        </div>
        {form.channels.includes("translation") ? (
          <label className="export-inline-field">
            <span>译文语言</span>
            <select
              value={form.translationLanguage}
              onChange={(event) => onChange({ translationLanguage: event.target.value })}
            >
              <option value="zh-CN">简体中文 · zh-CN</option>
              <option value="zh-TW">繁體中文 · zh-TW</option>
              <option value="en">English · en</option>
              <option value="ja">日本語 · ja</option>
              <option value="ko">한국어 · ko</option>
            </select>
          </label>
        ) : null}
        <label className="export-inline-field">
          <span>修订策略</span>
          <select
            value={form.revision}
            onChange={(event) =>
              onChange({ revision: event.target.value as ExportFormState["revision"] })
            }
          >
            <option value="confirmed">仅导出已确认版本</option>
            <option value="head">导出当前版本（可能待确认）</option>
          </select>
        </label>
        <small>所选通道统一采用此修订策略；预览会冻结实际 revision ID，执行时不会漂移。</small>
      </section>

      <section className="export-option">
        <span className="export-option__title">输出格式</span>
        <div className="export-check-grid">
          <label>
            <input
              type="checkbox"
              checked={form.formats.includes("txt")}
              onChange={() => toggleFormat("txt")}
            />
            <span>训练用 TXT</span>
          </label>
          <label>
            <input
              type="checkbox"
              checked={form.formats.includes("json")}
              onChange={() => toggleFormat("json")}
            />
            <span>逐图 JSON</span>
          </label>
        </div>
        <small>
          多通道 TXT 会生成相互独立的训练集目录；JSON 会在一份元数据中保留所有所选通道。
        </small>
      </section>

      <section className="export-option">
        <span className="export-option__title">导出目录</span>
        <button
          type="button"
          className="export-folder-picker"
          disabled={activeExport}
          onClick={onChooseFolder}
        >
          <FolderOpen size={16} />
          <span title={form.destinationPath}>
            {form.destinationPath || "使用系统目录选择器选择空文件夹"}
          </span>
        </button>
        <small>选择的文件夹就是最终输出位置，且必须为空；导出不会修改项目内的旧 TXT。</small>
      </section>

      <section className="export-option export-rules">
        <span className="export-option__title">固定规则</span>
        <dl>
          <div>
            <dt>图片</dt>
            <dd>原始字节复制</dd>
          </div>
          <div>
            <dt>标注</dt>
            <dd>冻结的数据库修订</dd>
          </div>
          <div>
            <dt>目录结构</dt>
            <dd>
              {form.channels.length > 1 && form.formats.includes("txt")
                ? "按通道分目录"
                : "单通道扁平"}
            </dd>
          </div>
          <div>
            <dt>覆盖文件</dt>
            <dd>不允许</dd>
          </div>
        </dl>
      </section>

      {preview?.warning_count ? (
        <p className="export-warning">
          发现 {preview.warning_count} 个可强制忽略的标注警告；开始导出时会再次确认。
        </p>
      ) : null}
      {activeExport ? (
        <p className="export-notice">当前已有导出任务，范围和目录会在任务结束后重新开放。</p>
      ) : null}
      {error ? <p className="form-error">{error}</p> : null}

      <div className="export-actions">
        <Button
          icon={previewPending ? <Spinner /> : <Eye size={14} />}
          disabled={!readyToPreview || previewPending || exportPending}
          onClick={onPreview}
        >
          校验并预览
        </Button>
        <Button
          tone="primary"
          icon={exportPending ? <Spinner /> : <PackageOpen size={14} />}
          disabled={!readyToExport || previewPending || exportPending}
          onClick={onExport}
        >
          开始导出
        </Button>
      </div>
    </aside>
  );
}
