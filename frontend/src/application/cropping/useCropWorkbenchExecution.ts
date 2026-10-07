import { useUnsavedChangesStore } from "../../shared/store/unsavedChangesStore";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { executeCrop, listCropOperations, undoCrop } from "../../features/cropping/api";
import { previewMultiple, previewPositioned } from "../../features/cropping/workbenchApi";
import { invalidateWorkspaceMutation } from "../../shared/query/workspaceQueries";
import type { ConfirmInteraction } from "../interaction";
import {
  cropScopeKey,
  cropWorkbenchState,
  markOperationUndone,
  hasUnsavedCropDrafts,
  type CropMode,
} from "./workbenchState";
import {
  pendingSubmission,
  repeatSubmission,
  recordSubmission,
  submissionIsCurrent,
  type CropSubmission,
} from "./workbenchSubmission";

export function useCropWorkbenchExecution(
  project: string,
  mode: CropMode,
  confirm: ConfirmInteraction,
) {
  const key = cropScopeKey(project, mode);
  const state = cropWorkbenchState.useValue(key);
  const client = useQueryClient();
  const operations = useQuery({
    queryKey: ["crop-operations", project],
    queryFn: () => listCropOperations(project),
    refetchInterval: state.phase !== "idle" ? 1000 : false,
  });
  function syncSessionDrafts() {
    for (const target of ["single", "batch"] as const) {
      const scope = cropScopeKey(project, target);
      useUnsavedChangesStore
        .getState()
        .setSessionDirtyScope(
          `crop-workbench:${scope}`,
          hasUnsavedCropDrafts(cropWorkbenchState.get(scope).drafts),
        );
    }
  }
  async function generate(collect: () => CropSubmission, label: string) {
    if (cropWorkbenchState.get(key).phase !== "idle") return;
    let submission: CropSubmission | null = null;
    try {
      const snapshot = cropWorkbenchState.get(key);
      if (mode === "batch" && !snapshot.ratioValid) throw new Error("统一比例无效，请先修正比例。");
      submission = collect();
      cropWorkbenchState.patch(key, { phase: "previewing", error: null });
      const plan =
        mode === "batch"
          ? await previewPositioned(project, { items: submission.items, ratio: snapshot.ratio })
          : await previewMultiple(project, { items: submission.items });
      if (!plan.id || !plan.token || plan.total !== submission.marks.length)
        throw new Error("裁剪预览响应与待处理区域数量不一致，已阻止执行。");
      cropWorkbenchState.patch(key, { phase: "confirming" });
      if (
        !(await confirm({
          title: label,
          message: `已验证 ${submission.items.length} 张源图、${plan.total} 个区域，将复制生成 ${plan.total} 张新 PNG；原图与已有结果均不覆盖，是否执行？`,
        }))
      )
        return;
      if (!submissionIsCurrent(cropWorkbenchState.get(key), submission))
        throw new Error("裁剪草稿已变化，请重新生成预览后执行。");
      cropWorkbenchState.patch(key, { phase: "executing" });
      const result = await executeCrop(project, plan);
      if (result.status !== "succeeded")
        throw new Error(
          `裁剪没有成功完成：operation=${result.id}，status=${result.status}，原因=${result.error}`,
        );
      const finished = submission;
      cropWorkbenchState.patch(key, (current) =>
        recordSubmission(current, finished, result.id, null),
      );
      await invalidateWorkspaceMutation(client, project, "preprocessing-changed");
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      const failed = submission;
      cropWorkbenchState.patch(key, (current) => ({
        ...(failed ? recordSubmission(current, failed, null, message) : current),
        error: message,
      }));
    } finally {
      cropWorkbenchState.patch(key, { phase: "idle" });
      syncSessionDrafts();
      await operations.refetch();
    }
  }
  function generateCurrent() {
    return generate(() => {
      const current = cropWorkbenchState.get(key);
      if (!current.activeId) throw new Error("请先选择源图片。");
      if (!current.sourceIds.includes(current.activeId))
        throw new Error("当前图片不在处理范围内，请先勾选或调整范围。");
      return pendingSubmission(current, [current.activeId]);
    }, "生成当前图片的待处理区域");
  }
  function generateAll() {
    return generate(() => {
      const current = cropWorkbenchState.get(key);
      return pendingSubmission(current, current.sourceIds);
    }, "生成全部待处理结果");
  }
  function regenerateCurrent() {
    return generate(() => {
      const current = cropWorkbenchState.get(key);
      if (!current.activeId) throw new Error("请先选择源图片。");
      if (!current.sourceIds.includes(current.activeId))
        throw new Error("当前图片不在处理范围内，请先勾选或调整范围。");
      return repeatSubmission(current, current.activeId);
    }, "重新复制生成当前图片的全部区域");
  }
  async function undo(id: string) {
    if (cropWorkbenchState.get(key).phase !== "idle") return;
    cropWorkbenchState.patch(key, { phase: "confirming", error: null });
    try {
      if (
        !(await confirm({
          title: "撤销裁剪",
          message: "仅移除本次生成的新图片；已有标注、修改或后续依赖时将拒绝撤销。",
        }))
      )
        return;
      cropWorkbenchState.patch(key, { phase: "undoing" });
      await undoCrop(project, id);
      for (const target of ["single", "batch"] as const) {
        cropWorkbenchState.patch(cropScopeKey(project, target), (current) =>
          markOperationUndone(current, id),
        );
      }
      await invalidateWorkspaceMutation(client, project, "preprocessing-changed");
    } catch (cause) {
      cropWorkbenchState.patch(key, {
        error: cause instanceof Error ? cause.message : String(cause),
      });
    } finally {
      cropWorkbenchState.patch(key, { phase: "idle" });
      syncSessionDrafts();
      await operations.refetch();
    }
  }
  return { operations, generateCurrent, generateAll, regenerateCurrent, undo };
}
