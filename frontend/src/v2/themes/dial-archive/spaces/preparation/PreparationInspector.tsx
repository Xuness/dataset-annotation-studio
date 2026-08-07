import { forwardRef, type ReactNode } from "react";

import type {
  PreparationCanvasNodeId,
  PreparationOperationSummary,
  PreparationWorkbenchContent,
} from "../../../../pages/spaces/spacePageModel";
import { PREPARATION_NODE_PRESENTATION } from "./model/preparationPresentation";

interface PreparationInspectorProps {
  content: PreparationWorkbenchContent;
  node: PreparationCanvasNodeId;
  onClose(): void;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="dial-archive-preparation-inspector__field">
      <span>{label}</span>
      {children}
    </label>
  );
}

function formatDate(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString("zh-CN", { hour12: false }) : value;
}

function OperationReadout({ operation }: { operation: PreparationOperationSummary }) {
  return (
    <div className="dial-archive-preparation-inspector__operation">
      <div>
        <span>OPERATION</span>
        <b>{operation.id}</b>
      </div>
      <dl>
        <div>
          <dt>STATUS</dt>
          <dd>{operation.statusLabel}</dd>
        </div>
        <div>
          <dt>PASS</dt>
          <dd>{operation.progressPercent}%</dd>
        </div>
        <div>
          <dt>BACKEND</dt>
          <dd>{operation.backendLabel}</dd>
        </div>
        <div>
          <dt>FINISHED</dt>
          <dd>{formatDate(operation.completedAt)}</dd>
        </div>
      </dl>
      <ul>
        {operation.optionSummary.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
      {operation.errorMessage ? <p role="alert">{operation.errorMessage}</p> : null}
    </div>
  );
}

export const PreparationInspector = forwardRef<HTMLElement, PreparationInspectorProps>(
  function PreparationInspector({ content, node, onClose }, ref) {
    const { inspectorCode: code, inspectorTitle: title } = PREPARATION_NODE_PRESENTATION[node];
    const operation = content.selectedOperation ?? content.activeOperation;
    const form = content.form;
    const locked = content.workspaceBusy || Boolean(operation);
    const hasCapability = form.resizeEnabled || form.convertEnabled || form.renameEnabled;
    const scopeChoices = [
      {
        id: "all",
        code: "ALL.00",
        title: "整个项目",
        detail: "工作目录中的全部有效素材",
        count: content.assetCount,
        disabled: false,
      },
      {
        id: "selected",
        code: "SEL.01",
        title: "工作台已选素材",
        detail: "使用 03 素材施工场维护的选中集合",
        count: content.checkedCount,
        disabled: content.checkedCount === 0,
      },
      {
        id: "folder",
        code: "DIR.02",
        title: "素材子文件夹",
        detail: "包含所选目录分支下的全部下级目录",
        count: form.scope === "folder" ? content.scopeCount : 0,
        disabled: content.folderLoading || content.folderOptions.length === 0,
      },
    ] as const;
    const activeScope = scopeChoices.find((choice) => choice.id === form.scope) ?? scopeChoices[0];

    return (
      <aside
        ref={ref}
        className={`dial-archive-preparation-inspector is-${node}`}
        aria-label={`${title}检查器`}
      >
        <header>
          <div>
            <span>NODE INSPECTOR //</span>
            <b>{code}</b>
            <h2>{title}</h2>
          </div>
          <button type="button" aria-label="关闭节点检查器" onClick={onClose}>
            ×
          </button>
        </header>

        <div className="dial-archive-preparation-inspector__body">
          {operation && !["source", "scope", "recovery"].includes(node) ? (
            <OperationReadout operation={operation} />
          ) : null}

          {node === "source" ? (
            <div className="dial-archive-preparation-inspector__source">
              <span>LOCKED PROJECT CONTEXT</span>
              <h3>{content.project?.name ?? "NO CONTEXT"}</h3>
              <p>{content.project?.rootPath ?? "请先在项目档案中装载一个本地目录。"}</p>
              <dl>
                <div>
                  <dt>PROJECT ID</dt>
                  <dd>{content.project?.id ?? "—"}</dd>
                </div>
                <div>
                  <dt>ASSETS</dt>
                  <dd>{content.assetCount}</dd>
                </div>
              </dl>
            </div>
          ) : null}

          {node === "scope" ? (
            <fieldset className="dial-archive-preparation-inspector__scope">
              <legend>
                <span>选择任务处理范围</span>
                <b>{content.scopeCount.toLocaleString()}</b>
              </legend>
              <div className="dial-archive-preparation-inspector__scope-choices">
                {scopeChoices.map((choice) => (
                  <label
                    className={choice.disabled ? "is-disabled" : undefined}
                    data-code={choice.code}
                    key={choice.id}
                  >
                    <input
                      type="radio"
                      name="preparation-scope"
                      checked={form.scope === choice.id}
                      disabled={locked || choice.disabled}
                      onChange={() =>
                        content.updateForm({
                          scope: choice.id,
                          ...(choice.id === "folder" && !form.folderPath
                            ? { folderPath: content.folderOptions[0]?.id ?? "" }
                            : {}),
                        })
                      }
                    />
                    <span>
                      <em>{choice.code}</em>
                      <b>{choice.title}</b>
                      <small>{choice.detail}</small>
                    </span>
                    <strong>{choice.count.toLocaleString()}</strong>
                  </label>
                ))}
              </div>
              {form.scope === "folder" ? (
                <label className="dial-archive-preparation-inspector__scope-folder">
                  <span>
                    <em>DIRECTORY BRANCH</em>
                    <b>当前素材分支</b>
                  </span>
                  <select
                    value={form.folderPath}
                    aria-label="整备素材子文件夹"
                    disabled={locked || content.folderLoading}
                    onChange={(event) => content.updateForm({ folderPath: event.target.value })}
                  >
                    {content.folderOptions.length === 0 ? (
                      <option value="">当前项目没有素材子文件夹</option>
                    ) : null}
                    {content.folderOptions.map((folder) => (
                      <option value={folder.id} key={folder.id}>
                        {folder.detail} · {folder.count.toLocaleString()} 素材
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              <div className="dial-archive-preparation-inspector__scope-summary">
                <span>
                  <small>ACTIVE SOURCE</small>
                  <b>{activeScope.title}</b>
                </span>
                <strong>{content.scopeCount.toLocaleString()}</strong>
                <span>
                  <small>RANGE EVIDENCE</small>
                  <b>
                    {form.scope === "folder"
                      ? form.folderPath || "尚未选择目录"
                      : form.scope === "selected"
                        ? `${content.checkedCount.toLocaleString()} 项已选`
                        : "项目根目录"}
                  </b>
                </span>
              </div>
              <button
                className="dial-archive-preparation-inspector__scope-handoff"
                type="button"
                onClick={content.openAnnotationStage}
              >
                <span>
                  <small>03 / MATERIAL YARD</small>
                  <b>前往素材施工场选取素材</b>
                </span>
                <em>OPEN STAGE →</em>
              </button>
              {content.scopeMessage ? (
                <p className="dial-archive-preparation-inspector__note" role="status">
                  {content.scopeMessage}
                </p>
              ) : null}
            </fieldset>
          ) : null}

          {node === "geometry" && !operation ? (
            <fieldset disabled={content.workspaceBusy}>
              <legend>
                <label className="dial-archive-preparation-inspector__toggle">
                  <input
                    type="checkbox"
                    checked={form.resizeEnabled}
                    onChange={(event) =>
                      content.updateForm({ resizeEnabled: event.target.checked })
                    }
                  />
                  <span>启用尺寸与几何</span>
                </label>
              </legend>
              <Field label="目标最长边">
                <input
                  type="number"
                  min={64}
                  max={65536}
                  value={form.maxEdge}
                  onChange={(event) => content.updateForm({ maxEdge: event.target.valueAsNumber })}
                />
              </Field>
              <Field label="缩放算法">
                <select
                  value={form.resizeAlgorithm}
                  onChange={(event) =>
                    content.updateForm({
                      resizeAlgorithm: event.target.value as typeof form.resizeAlgorithm,
                    })
                  }
                >
                  <option value="lanczos3">Lanczos 3 · 锐利</option>
                  <option value="lanczos4">Lanczos 4</option>
                  <option value="anime_low_halo">二次元低光晕</option>
                </select>
              </Field>
              <label className="dial-archive-preparation-inspector__check">
                <input
                  type="checkbox"
                  checked={form.allowUpscale}
                  onChange={(event) => content.updateForm({ allowUpscale: event.target.checked })}
                />
                允许将较小素材放大到目标边长
              </label>
            </fieldset>
          ) : null}

          {node === "encoding" && !operation ? (
            <fieldset disabled={content.workspaceBusy}>
              <legend>
                <label className="dial-archive-preparation-inspector__toggle">
                  <input
                    type="checkbox"
                    checked={form.convertEnabled}
                    onChange={(event) =>
                      content.updateForm({ convertEnabled: event.target.checked })
                    }
                  />
                  <span>启用格式与编码</span>
                </label>
              </legend>
              <Field label="目标格式">
                <select
                  value={form.format}
                  onChange={(event) =>
                    content.updateForm({ format: event.target.value as typeof form.format })
                  }
                >
                  <option value="webp">WEBP</option>
                  <option value="jpeg">JPEG</option>
                  <option value="png">PNG</option>
                </select>
              </Field>
              <Field label={`质量 // ${form.quality}`}>
                <input
                  type="range"
                  min={1}
                  max={100}
                  value={form.quality}
                  onChange={(event) => content.updateForm({ quality: event.target.valueAsNumber })}
                />
              </Field>
              <Field label={`编码强度 // ${form.effort}`}>
                <input
                  type="range"
                  min={0}
                  max={6}
                  value={form.effort}
                  onChange={(event) => content.updateForm({ effort: event.target.valueAsNumber })}
                />
              </Field>
            </fieldset>
          ) : null}

          {node === "identity" && !operation ? (
            <fieldset disabled={content.workspaceBusy}>
              <legend>
                <label className="dial-archive-preparation-inspector__toggle">
                  <input
                    type="checkbox"
                    checked={form.renameEnabled}
                    onChange={(event) =>
                      content.updateForm({ renameEnabled: event.target.checked })
                    }
                  />
                  <span>启用文件与身份</span>
                </label>
              </legend>
              <Field label="命名模板">
                <input
                  type="text"
                  value={form.renameTemplate}
                  onChange={(event) => content.updateForm({ renameTemplate: event.target.value })}
                />
              </Field>
              <div className="dial-archive-preparation-inspector__split">
                <Field label="起始序号">
                  <input
                    type="number"
                    min={0}
                    value={form.renameStartIndex}
                    onChange={(event) =>
                      content.updateForm({ renameStartIndex: event.target.valueAsNumber })
                    }
                  />
                </Field>
                <Field label="补零位数">
                  <input
                    type="number"
                    min={1}
                    max={12}
                    value={form.renamePadding}
                    onChange={(event) =>
                      content.updateForm({ renamePadding: event.target.valueAsNumber })
                    }
                  />
                </Field>
              </div>
              <p className="dial-archive-preparation-inspector__note">
                标注、译文与 JSON 旁车将跟随图片同步更名。
              </p>
            </fieldset>
          ) : null}

          {node === "preview" && !operation ? (
            <div className="dial-archive-preparation-inspector__preview">
              <div className="dial-archive-preparation-inspector__metrics">
                <span>
                  CHANGED <b>{content.preview?.changedCount ?? "—"}</b>
                </span>
                <span>
                  UNCHANGED <b>{content.preview?.unchangedCount ?? "—"}</b>
                </span>
                <span className={content.preview?.warningCount ? "is-warning" : ""}>
                  WARNING <b>{content.preview?.warningCount ?? "—"}</b>
                </span>
              </div>
              <button
                className="dial-archive-preparation-inspector__primary"
                type="button"
                disabled={
                  !hasCapability ||
                  !content.scopeReady ||
                  content.previewPending ||
                  content.workspaceBusy
                }
                onClick={() => void content.previewAction()}
              >
                <b>{content.previewPending ? "正在生成预演" : "生成方案预演"}</b>
                <em>BUILD PREVIEW →</em>
              </button>
              {content.preview?.items.slice(0, 4).map((item) => (
                <div
                  className="dial-archive-preparation-inspector__preview-item"
                  key={item.assetId}
                >
                  <b>{item.beforeRelativePath}</b>
                  <span>
                    {item.beforeWidth}×{item.beforeHeight} → {item.afterWidth}×{item.afterHeight}
                  </span>
                  <em>{item.warning ?? (item.willChange ? "CHANGE" : "UNCHANGED")}</em>
                </div>
              ))}
            </div>
          ) : null}

          {node === "commit" && !operation ? (
            <fieldset disabled={content.workspaceBusy}>
              <legend>执行通道</legend>
              <Field label="路线策略">
                <select
                  value={form.executionMode}
                  onChange={(event) =>
                    content.updateForm({
                      executionMode: event.target.value as typeof form.executionMode,
                    })
                  }
                >
                  <option value="auto">自动选择</option>
                  <option value="cpu_only">仅 CPU</option>
                  <option value="prefer_accelerator">优先硬件加速</option>
                </select>
              </Field>
              {form.executionMode === "prefer_accelerator" ? (
                <Field label="加速后端">
                  <select
                    value={form.acceleratorId}
                    onChange={(event) => content.updateForm({ acceleratorId: event.target.value })}
                  >
                    <option value="">自动选择可用设备</option>
                    {content.backends
                      .filter((backend) => backend.id !== "cpu")
                      .map((backend) => (
                        <option
                          value={backend.id}
                          disabled={backend.status === "unavailable"}
                          key={backend.id}
                        >
                          {backend.label} {backend.deviceName ? `· ${backend.deviceName}` : ""}
                        </option>
                      ))}
                  </select>
                </Field>
              ) : null}
              <div className="dial-archive-preparation-inspector__route">
                <span>
                  BACKEND <b>{content.executionPlan?.backendId ?? "—"}</b>
                </span>
                <span>
                  WORKERS <b>{content.executionPlan?.effectiveWorkers ?? "—"}</b>
                </span>
                <span>
                  BATCH <b>{content.executionPlan?.effectiveBatchSize ?? "—"}</b>
                </span>
              </div>
              <button
                className="dial-archive-preparation-inspector__primary"
                type="button"
                disabled={
                  !content.preview ||
                  Boolean(content.preview.warningCount) ||
                  content.executionPlanPending ||
                  content.workspaceBusy
                }
                onClick={() => void content.executeAction()}
              >
                <b>提交并执行</b>
                <em>COMMIT TASK →</em>
              </button>
              {!content.preview ? (
                <p className="dial-archive-preparation-inspector__note">必须先生成有效预演。</p>
              ) : null}
              {content.executionPlanError ? (
                <p className="dial-archive-preparation-inspector__error" role="alert">
                  {content.executionPlanError}
                </p>
              ) : null}
            </fieldset>
          ) : null}

          {node === "recovery" ? (
            <div className="dial-archive-preparation-inspector__recovery">
              {operation ? (
                <OperationReadout operation={operation} />
              ) : (
                <p>当前没有可追溯的任务记录。</p>
              )}
              {operation?.canRecover ? (
                <button
                  type="button"
                  disabled={content.workspaceBusy}
                  onClick={() => void content.undoAction(operation.id)}
                >
                  <b>撤销并恢复源版本</b>
                  <em>VERIFY &amp; RECOVER →</em>
                </button>
              ) : operation ? (
                <p>只有最新一条已完成操作可以通过安全校验进入恢复。</p>
              ) : null}
            </div>
          ) : null}
        </div>
        <footer>
          <span>NODE // {code}</span>
          <span>{locked ? "READ ONLY" : "PARAMETERS READY"}</span>
        </footer>
      </aside>
    );
  },
);
