import { useState } from "react";
import { Eye, FileArchive, FolderOpen, FolderTree, PackageOpen } from "lucide-react";

import type {
  AnnotationChannel,
  AssetFolderSummary,
  ExportChannelSelection,
  ExportDirectoryMode,
  ExportFormat,
  ExportPreview,
} from "../../../../src/shared/api/types";
import { Button } from "../../../shared/ui/Button";
import { Spinner } from "../../../shared/ui/Spinner";
import type { ExportFormState } from "../../../../src/application/exports/exportState";
import { ExportDirectoryRulesDialog } from "./ExportDirectoryRulesDialog";

interface Props {
  form: ExportFormState;
  assetCount: number;
  candidateActive: boolean;
  checkedCount: number;
  folders: AssetFolderSummary[];
  foldersError: string | null;
  foldersPending: boolean;
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

const channelLabels: Record<AnnotationChannel, string> = {
  existing_annotation: "原有标注",
  tags: "Tags",
  description: "LLM 描述",
  translation: "翻译",
};
const defaultTranslationLanguages = ["zh-CN", "zh-TW", "en", "ja", "ko"];

export function ExportSettingsPanel({
  form,
  assetCount,
  candidateActive,
  checkedCount,
  folders,
  foldersError,
  foldersPending,
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
  const [directoryRulesOpen, setDirectoryRulesOpen] = useState(false);
  const validScope = form.scope === "all" || checkedCount > 0;
  const readyToPreview = Boolean(
    form.destinationPath &&
    validScope &&
    form.selections.length &&
    form.selections.every(
      (selection) => selection.channel !== "translation" || selection.language.trim(),
    ) &&
    new Set(
      form.selections.map(
        (selection) =>
          `${selection.channel}:${selection.translation_source_kind ?? ""}:${
            selection.translation_producer_kind ?? ""
          }:${selection.language.trim().toLowerCase()}`,
      ),
    ).size === form.selections.length &&
    form.formats.length &&
    !activeExport,
  );
  const readyToExport = Boolean(
    preview && !preview.blocking_issue_count && preview.total_items && !activeExport,
  );

  function toggleChannel(channel: AnnotationChannel) {
    const selected = form.selections.some((selection) => selection.channel === channel);
    onChange({
      selections: selected
        ? form.selections.filter((selection) => selection.channel !== channel)
        : [
            ...form.selections,
            {
              channel,
              language: channel === "translation" ? nextTranslationLanguage() : "",
              translation_source_kind: channel === "translation" ? "description" : null,
              translation_producer_kind: channel === "translation" ? "llm" : null,
              revision: "current",
            },
          ],
    });
  }

  function nextTranslationLanguage() {
    const selected = new Set(
      form.selections
        .filter((selection) => selection.channel === "translation")
        .map((selection) => selection.language.toLowerCase()),
    );
    return (
      defaultTranslationLanguages.find((language) => !selected.has(language.toLowerCase())) ?? ""
    );
  }

  function updateSelection(index: number, update: Partial<ExportChannelSelection>) {
    onChange({
      selections: form.selections.map((selection, current) =>
        current === index ? { ...selection, ...update } : selection,
      ),
    });
  }

  function addTranslation() {
    onChange({
      selections: [
        ...form.selections,
        {
          channel: "translation",
          language: nextTranslationLanguage(),
          translation_source_kind: "description",
          translation_producer_kind: "llm",
          revision: "current",
        },
      ],
    });
  }

  function removeSelection(index: number) {
    onChange({
      selections: form.selections.filter((_, current) => current !== index),
    });
  }

  function toggleFormat(format: ExportFormat) {
    onChange({
      formats: form.formats.includes(format)
        ? form.formats.filter((value) => value !== format)
        : [...form.formats, format],
    });
  }

  function selectDirectoryMode(mode: ExportDirectoryMode) {
    onChange({
      directoryLayout: {
        ...form.directoryLayout,
        mode,
      },
    });
    if (mode === "custom") setDirectoryRulesOpen(true);
  }

  const mergedDirectoryCount = form.directoryLayout.merge_into_parent_paths?.length ?? 0;
  const directoryRuleLabel =
    form.directoryLayout.mode === "flat"
      ? form.selections.length > 1 && form.formats.includes("txt")
        ? "按通道分目录，其余扁平"
        : "扁平化"
      : form.directoryLayout.mode === "preserve"
        ? form.selections.length > 1 && form.formats.includes("txt")
          ? "按通道保留原目录"
          : "保留原目录"
        : `自定义合并 ${mergedDirectoryCount} 个目录`;

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
          {candidateActive ? "候选工作集" : "当前项目"}
          <small>{assetCount} 张</small>
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
          {(Object.entries(channelLabels) as Array<[AnnotationChannel, string]>).map(
            ([channel, label]) => (
              <label key={channel}>
                <input
                  type="checkbox"
                  checked={form.selections.some((selection) => selection.channel === channel)}
                  onChange={() => toggleChannel(channel)}
                />
                <span>{label}</span>
              </label>
            ),
          )}
        </div>
        <div className="export-channel-config-list">
          {form.selections.map((selection, index) => (
            <div className="export-channel-config" key={`${selection.channel}:${index}`}>
              <strong>{channelLabels[selection.channel]}</strong>
              {selection.channel === "translation" ? (
                <>
                  <select
                    aria-label={`译文来源 ${index + 1}`}
                    value={selection.translation_source_kind ?? "description"}
                    onChange={(event) =>
                      updateSelection(index, {
                        translation_source_kind: event.target
                          .value as ExportChannelSelection["translation_source_kind"],
                        translation_producer_kind:
                          event.target.value === "description"
                            ? "llm"
                            : selection.translation_producer_kind,
                      })
                    }
                  >
                    <option value="description">LLM 描述</option>
                    <option value="tags">Tags</option>
                  </select>
                  <select
                    aria-label={`译文生成方式 ${index + 1}`}
                    value={selection.translation_producer_kind ?? "llm"}
                    onChange={(event) =>
                      updateSelection(index, {
                        translation_producer_kind: event.target
                          .value as ExportChannelSelection["translation_producer_kind"],
                        translation_source_kind:
                          event.target.value === "local_dictionary"
                            ? "tags"
                            : selection.translation_source_kind,
                      })
                    }
                  >
                    <option value="llm">LLM 翻译</option>
                    <option value="local_dictionary">本地 Tag 词典</option>
                  </select>
                  <input
                    aria-label={`译文语言 ${index + 1}`}
                    value={selection.language}
                    placeholder="BCP 47，例如 fr 或 zh-CN"
                    onChange={(event) => updateSelection(index, { language: event.target.value })}
                  />
                </>
              ) : null}
              <select
                aria-label={`${channelLabels[selection.channel]}修订策略`}
                value={selection.revision}
                onChange={(event) =>
                  updateSelection(index, {
                    revision: event.target.value as ExportChannelSelection["revision"],
                  })
                }
              >
                <option value="current">当前版本</option>
                <option value="reviewed">已人工复核版本</option>
              </select>
              {selection.channel === "translation" ? (
                <button type="button" onClick={() => removeSelection(index)}>
                  移除
                </button>
              ) : null}
            </div>
          ))}
          {form.selections.some((selection) => selection.channel === "translation") ? (
            <button type="button" className="export-add-translation" onClick={addTranslation}>
              添加另一种译文语言
            </button>
          ) : null}
        </div>
        <small>每种译文来源和语言可以独立选择修订策略；预览会冻结实际 revision ID。</small>
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
        <span className="export-option__title">目录结构</span>
        <div className="export-directory-mode-selector" role="group" aria-label="目录结构">
          {(
            [
              ["flat", "扁平化"],
              ["preserve", "保留原目录"],
              ["custom", "自定义合并"],
            ] as Array<[ExportDirectoryMode, string]>
          ).map(([mode, label]) => (
            <button
              type="button"
              key={mode}
              className={form.directoryLayout.mode === mode ? "is-active" : ""}
              aria-pressed={form.directoryLayout.mode === mode}
              disabled={activeExport}
              onClick={() => selectDirectoryMode(mode)}
            >
              {label}
            </button>
          ))}
        </div>
        {form.directoryLayout.mode === "custom" ? (
          <button
            type="button"
            className="export-directory-configure"
            disabled={activeExport}
            onClick={() => setDirectoryRulesOpen(true)}
          >
            <span>
              <strong>合并规则</strong>
              <small>
                {mergedDirectoryCount
                  ? `已选择 ${mergedDirectoryCount} 个目录层级`
                  : "尚未选择目录，当前效果等同于保留原目录"}
              </small>
            </span>
            <span>配置…</span>
          </button>
        ) : null}
        <small>
          {form.directoryLayout.mode === "flat"
            ? "兼容现有导出；不会保留素材在工作区中的父目录。"
            : form.directoryLayout.mode === "preserve"
              ? "按照图片相对于工作区根目录的当前路径输出。"
              : "从保留结构开始，将选中的目录内容上提到父级。"}
        </small>
      </section>

      <section className="export-option">
        <span className="export-option__title">输出方式</span>
        <div className="export-packaging-selector" role="group" aria-label="输出方式">
          <button
            type="button"
            className={form.packaging === "directory" ? "is-active" : ""}
            aria-pressed={form.packaging === "directory"}
            disabled={activeExport}
            onClick={() => onChange({ packaging: "directory" })}
          >
            <FolderTree size={15} />
            <span>文件夹</span>
          </button>
          <button
            type="button"
            className={form.packaging === "zip" ? "is-active" : ""}
            aria-pressed={form.packaging === "zip"}
            disabled={activeExport}
            onClick={() => onChange({ packaging: "zip" })}
          >
            <FileArchive size={15} />
            <span>ZIP 压缩包</span>
          </button>
        </div>
        <small>
          {form.packaging === "zip"
            ? "输出一个与所选目录同名的 .zip 文件。"
            : "直接输出图片、TXT 和 JSON 文件。"}
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
            {form.destinationPath || "使用系统目录选择器选择导出文件夹"}
          </span>
        </button>
        <small>
          {form.packaging === "zip"
            ? "压缩包会生成在该目录内；不会覆盖同名压缩包或修改目录中的其他文件。"
            : "选择的文件夹就是最终输出位置，且必须为空；导出不会修改项目内的旧 TXT。"}
        </small>
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
            <dd>{directoryRuleLabel}</dd>
          </div>
          <div>
            <dt>覆盖文件</dt>
            <dd>不允许</dd>
          </div>
          <div>
            <dt>封装</dt>
            <dd>{form.packaging === "zip" ? "ZIP 压缩包" : "文件夹"}</dd>
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
          icon={
            exportPending ? (
              <Spinner />
            ) : form.packaging === "zip" ? (
              <FileArchive size={14} />
            ) : (
              <PackageOpen size={14} />
            )
          }
          disabled={!readyToExport || previewPending || exportPending}
          onClick={onExport}
        >
          开始导出
        </Button>
      </div>

      <ExportDirectoryRulesDialog
        open={directoryRulesOpen}
        folders={folders}
        error={foldersError}
        loading={foldersPending}
        scopeDescription={
          form.scope === "selected"
            ? `工作台选中的 ${checkedCount} 张图片`
            : candidateActive
              ? `候选工作集中的 ${assetCount} 张图片`
              : `当前项目中的 ${assetCount} 张图片`
        }
        value={form.directoryLayout.merge_into_parent_paths ?? []}
        onClose={() => setDirectoryRulesOpen(false)}
        onApply={(paths) => {
          onChange({
            directoryLayout: {
              mode: "custom",
              merge_into_parent_paths: paths,
            },
          });
          setDirectoryRulesOpen(false);
        }}
      />
    </aside>
  );
}
