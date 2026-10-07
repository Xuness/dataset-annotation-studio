import { useEffect } from "react";
import type { AssetSummary, CropRect, Ratio } from "../../shared/api/types";
import type { ConfirmInteraction } from "../interaction";
import type { WorkspaceBrowserMode } from "../workspace/assetBrowserState";
import { useUnsavedChangesStore } from "../../shared/store/unsavedChangesStore";
import { centeredRect } from "./geometry";
import { useCropWorkbenchSources } from "./useCropWorkbenchSources";
import { useCropWorkbenchExecution } from "./useCropWorkbenchExecution";
import {
  cropScopeKey,
  cropWorkbenchState,
  pendingCount,
  hasUnsavedCropDrafts,
  createSourceDraft,
  hasManualPositions,
  replaceRectangles,
  resetBatchRatio,
  type CropMode,
  type SourceDraft,
  type CropView,
} from "./workbenchState";

export function useCropWorkbench(
  project: string,
  mode: CropMode,
  browserMode: WorkspaceBrowserMode,
  focus: string | null,
  entry: string | null,
  confirm: ConfirmInteraction,
) {
  const key = cropScopeKey(project, mode);
  const state = cropWorkbenchState.useValue(key);
  const sourceState = useCropWorkbenchSources(project, mode, browserMode, focus, entry);
  const execution = useCropWorkbenchExecution(project, mode, confirm);
  const current = state.activeId ? state.drafts[state.activeId] : null;
  const sources = state.sourceIds.map((id) => state.drafts[id]);
  const pending = sources.reduce((count, draft) => count + pendingCount(draft), 0);
  const unconfigured = sources.filter((draft) => !draft.regions.length).length;
  const busy = state.phase !== "idle";
  const unavailable = busy || sourceState.query.isFetching || sourceState.query.isError;
  useEffect(() => {
    const dirty = hasUnsavedCropDrafts(state.drafts);
    useUnsavedChangesStore.getState().setSessionDirtyScope(`crop-workbench:${key}`, dirty);
  }, [state.drafts, key]);
  function updateCurrent(update: (draft: SourceDraft) => SourceDraft) {
    cropWorkbenchState.patch(key, (latest) => {
      const id = latest.activeId;
      if (!id || !latest.sourceIds.includes(id) || latest.phase !== "idle") return latest;
      return { drafts: { ...latest.drafts, [id]: update(latest.drafts[id]) }, error: null };
    });
  }
  function changeRectangles(rectangles: CropRect[]) {
    const ids = rectangles.map(() => crypto.randomUUID());
    updateCurrent((draft) => replaceRectangles(draft, rectangles, ids));
  }
  function selectSource(id: string) {
    cropWorkbenchState.patch(key, { activeId: id, view: "editor" });
  }
  function browseSource(asset: AssetSummary) {
    cropWorkbenchState.patch(key, (latest) => {
      if (latest.phase !== "idle") return {};
      const source = {
        id: asset.id,
        filename: asset.filename,
        relative_path: asset.relative_path,
        width: asset.width,
        height: asset.height,
        content_version: asset.content_version,
      };
      return {
        activeId: asset.id,
        view: "editor",
        drafts: {
          ...latest.drafts,
          [asset.id]: latest.drafts[asset.id] ?? createSourceDraft(source, mode, latest.ratio),
        },
      };
    });
  }
  function changeView(view: CropView) {
    cropWorkbenchState.patch(key, { view });
  }
  async function changeRatio(ratio: Ratio) {
    const currentState = cropWorkbenchState.get(key);
    if (currentState.phase !== "idle") return false;
    if (currentState.ratio.width === ratio.width && currentState.ratio.height === ratio.height)
      return true;
    cropWorkbenchState.patch(key, { phase: "confirming" });
    try {
      if (
        hasManualPositions(currentState) &&
        !(await confirm({
          title: "更改统一比例",
          message: "更改比例将重新计算所有裁剪框，并重置已手动调整的位置，是否继续？",
        }))
      ) {
        cropWorkbenchState.patch(key, {
          ratioValid: true,
          ratioRevision: currentState.ratioRevision + 1,
        });
        return false;
      }
      cropWorkbenchState.patch(key, (latest) => resetBatchRatio(latest, ratio));
      return true;
    } catch (cause) {
      cropWorkbenchState.patch(key, {
        error: cause instanceof Error ? cause.message : String(cause),
        ratioRevision: currentState.ratioRevision + 1,
      });
      return false;
    } finally {
      cropWorkbenchState.patch(key, { phase: "idle" });
    }
  }
  async function reloadCurrent() {
    if (!current) return;
    const source = sourceState.query.data?.find((item) => item.id === current.source.id);
    if (!source) return;
    if (
      !(await confirm({
        title: "重新载入源图",
        message: "将丢弃这张图片的裁剪草稿并读取当前版本，已生成文件不会被删除。",
      }))
    )
      return;
    updateCurrent(() => createSourceDraft(source, mode, state.ratio));
  }
  function centerCurrent() {
    updateCurrent((draft) => ({
      ...draft,
      invalid: false,
      regions: draft.regions.map((region) => ({
        ...region,
        rectangle: centeredRect(draft.source.width, draft.source.height, state.ratio),
        failure: null,
        touched: true,
      })),
    }));
  }
  return {
    key,
    mode,
    browserMode,
    focus,
    entry,
    state,
    current,
    currentInScope: Boolean(current && state.sourceIds.includes(current.source.id)),
    sources,
    pending,
    unconfigured,
    busy,
    unavailable,
    sourceState,
    execution,
    updateCurrent,
    changeRectangles,
    selectSource,
    browseSource,
    changeView,
    changeRatio,
    reloadCurrent,
    centerCurrent,
    patch: (update: Partial<typeof state>) => cropWorkbenchState.patch(key, update),
  };
}
export type CropWorkbenchController = ReturnType<typeof useCropWorkbench>;
