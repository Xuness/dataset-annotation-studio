import { Crop, LayoutGrid, ImagePlus } from "lucide-react";
import type { WorkspaceBrowserMode } from "../../../src/application/workspace/assetBrowserState";
import type { CropMode } from "../../../src/application/cropping/workbenchState";
import { pendingCount } from "../../../src/application/cropping/workbenchState";
import { useCropWorkbench } from "../../../src/application/cropping/useCropWorkbench";
import { legacyConfirm } from "../../legacy/legacyInteractions";
import { Button } from "../../shared/ui/Button";
import { CropSourceSidebar } from "./CropSourceSidebar";
import { CropSourceEditor } from "./CropSourceEditor";
import { CropOverview } from "./CropOverview";
import { CropHistory } from "./CropHistory";
import { RatioControl } from "./RatioControl";
import "./cropping.css";
import "./crop-workbench.css";

interface Props {
  projectId: string;
  mode: CropMode;
  browserMode: WorkspaceBrowserMode;
  focusAssetId: string | null;
  entry: string | null;
}
export function CropWorkbench({ projectId, mode, browserMode, focusAssetId, entry }: Props) {
  const c = useCropWorkbench(projectId, mode, browserMode, focusAssetId, entry, legacyConfirm);
  const currentPending = c.current ? pendingCount(c.current) : 0;
  const invalid = c.sources.some((draft) => draft.invalid || draft.sourceError);
  const recoveryProblems = (c.execution.operations.data ?? []).filter(
    (item) => item.status === "recovery_failed" || (item.status === "undoing" && item.error),
  );
  const blocked =
    c.unavailable || recoveryProblems.length > 0 || (mode === "batch" && !c.state.ratioValid);
  const error =
    c.state.error || c.sourceState.query.error?.message || c.execution.operations.error?.message;
  const controls = (
    <>
      {recoveryProblems.length > 0 && (
        <p className="form-error" role="alert" data-testid="crop-recovery-blocked">
          当前项目的裁剪恢复尚未完成，已禁止继续生成图片；其他项目仍可使用。
          请查看下方裁剪记录中的具体错误，修复文件问题后重新启动应用以重试恢复。
        </p>
      )}
      {mode === "batch" && (
        <details className="crop-unified-ratio" open={c.state.view === "overview"}>
          <summary data-testid="crop-unified-ratio-toggle">
            统一裁剪比例 · {c.state.ratio.width}:{c.state.ratio.height}
          </summary>
          <RatioControl
            resetEpoch={0}
            ratio={c.state.ratio}
            disabled={c.unavailable}
            onChange={c.changeRatio}
            onValidity={(valid) => c.patch({ ratioValid: valid })}
          />
        </details>
      )}
      {error && (
        <p className="form-error" role="alert" data-testid="crop-workbench-error">
          {error}
        </p>
      )}
      {c.sourceState.query.isFetching && (
        <p role="status" className="crop-description">
          正在载入当前范围的源图片…
        </p>
      )}
    </>
  );
  const history = (
    <details
      className="crop-workspace-history"
      data-testid="crop-history-expand"
      open={recoveryProblems.length ? true : undefined}
    >
      <summary>裁剪记录 · {c.execution.operations.data?.length ?? 0} 笔操作</summary>
      <CropHistory
        operations={c.execution.operations.data ?? []}
        busy={c.busy}
        onUndo={(id) => void c.execution.undo(id)}
      />
    </details>
  );
  const editing = Boolean(c.current) && c.state.view === "editor";
  return (
    <div className="crop-inline-workbench" data-testid={`crop-${mode}-workbench`}>
      <CropSourceSidebar projectId={projectId} controller={c} />
      <section className="crop-right-workspace" data-testid="crop-right-workspace">
        <header className="crop-workspace-header">
          <div>
            <span className="eyebrow">Crop workspace</span>
            <h2>{c.state.view === "editor" ? "单图操作" : "全部素材处理总览"}</h2>
          </div>
          <nav aria-label="裁剪工作区视图">
            <Button
              icon={<Crop size={14} />}
              data-testid="crop-view-editor"
              aria-pressed={c.state.view === "editor"}
              onClick={() => c.changeView("editor")}
            >
              单图操作
            </Button>
            <Button
              icon={<LayoutGrid size={14} />}
              data-testid="crop-view-overview"
              aria-pressed={c.state.view === "overview"}
              onClick={() => c.changeView("overview")}
            >
              总览 · {c.sources.length}
            </Button>
          </nav>
        </header>
        <div
          className={`crop-workspace-scroll${editing ? " is-editor" : ""}`}
          data-testid="crop-workspace-scroll"
        >
          {!editing && controls}
          {!c.sources.length && !c.current ? (
            <div className="crop-workspace-empty">
              <Crop size={30} />
              <h3>选择素材后开始裁剪</h3>
              <p>空勾选不会自动处理全部图片，原图与标注始终保持不变。</p>
            </div>
          ) : c.state.view === "editor" ? (
            <CropSourceEditor
              key={c.current?.source.id}
              projectId={projectId}
              controller={c}
              controls={controls}
              history={history}
            />
          ) : (
            <CropOverview projectId={projectId} controller={c} />
          )}
          {!editing && history}
        </div>
        <footer className="crop-workspace-footer">
          <div data-testid="crop-workbench-counts">
            {c.sources.length} 张源图 · {c.pending} 个待生成区域 · {c.unconfigured} 张未配置
            {c.busy && (
              <span role="status">
                {" "}
                ·{" "}
                {
                  {
                    previewing: "验证裁剪计划",
                    confirming: "等待确认",
                    executing: "正在生成",
                    undoing: "正在撤销",
                    idle: "",
                  }[c.state.phase]
                }
              </span>
            )}
          </div>
          <div className="crop-actions">
            <Button
              data-testid="crop-regenerate-current"
              disabled={
                blocked ||
                !c.currentInScope ||
                !c.current?.regions.length ||
                Boolean(c.current.invalid || c.current.sourceError)
              }
              onClick={() => void c.execution.regenerateCurrent()}
            >
              重新生成当前图
            </Button>
            <Button
              data-testid="crop-generate-current"
              icon={<ImagePlus size={14} />}
              disabled={
                blocked ||
                !c.currentInScope ||
                !currentPending ||
                Boolean(c.current?.invalid || c.current?.sourceError)
              }
              onClick={() => void c.execution.generateCurrent()}
            >
              生成当前图片 · {currentPending}
            </Button>
            <Button
              className="crop-primary-action"
              data-testid="crop-generate-all"
              icon={<ImagePlus size={14} />}
              disabled={blocked || invalid || !c.pending}
              onClick={() => void c.execution.generateAll()}
            >
              生成全部待处理 · {c.pending}
            </Button>
          </div>
        </footer>
      </section>
    </div>
  );
}
