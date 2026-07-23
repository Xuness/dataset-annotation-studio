import { Eye, FolderOpen, PackageOpen } from "lucide-react";

import type { ExportPreview } from "../../../shared/api/types";
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
  const readyToPreview = Boolean(form.destinationPath && validScope && !activeExport);
  const readyToExport = Boolean(
    preview && !preview.blocking_issue_count && preview.total_items && !activeExport,
  );

  return (
    <aside className="export-settings" data-surface-region="primary-sidebar">
      <header>
        <span className="export-icon">
          <PackageOpen size={18} />
        </span>
        <div>
          <span className="eyebrow">Validated flat copy</span>
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
        <small>选择的文件夹就是最终输出位置。文件会扁平放置，不创建子目录；目标必须为空。</small>
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
            <dd>仅活动同名 TXT</dd>
          </div>
          <div>
            <dt>目录结构</dt>
            <dd>不保留</dd>
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
