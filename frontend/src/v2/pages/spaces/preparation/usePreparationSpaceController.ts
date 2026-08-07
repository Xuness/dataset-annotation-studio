import { useMemo } from "react";

import {
  preprocessPreviewFolderPaths,
  preprocessWorkbenchState,
} from "../../../../application/preprocessing/preprocessState";
import { thumbnailUrl } from "../../../../features/assets/api";
import { useAssets } from "../../../../features/assets/hooks";
import { usePreprocessOperations } from "../../../../features/preprocessing/hooks";
import { useWorkspace } from "../../../../features/workspaces/hooks";
import { useWorkspaceSelectionStore } from "../../../../shared/store/workspaceSelectionStore";
import type {
  PreparationCanvasNodeId,
  PreparationCapabilityId,
  PreparationSpaceContent,
} from "../spacePageModel";
import {
  projectPreparationOperations,
  selectPreparationOperationSignals,
  toPreparationAssetSample,
  toPreparationProject,
} from "./preparationModel";

interface UsePreparationSpaceControllerOptions {
  projectId: string | null;
  onOpenArchive(): void;
  onOpenWorkbench(focus?: PreparationCapabilityId): void;
  onOpenOperation(operationId: string, focus?: PreparationCanvasNodeId): void;
}

function describeError(reason: unknown, fallback: string): string {
  return reason instanceof Error ? reason.message : fallback;
}

export function usePreparationSpaceController({
  projectId,
  onOpenArchive,
  onOpenWorkbench,
  onOpenOperation,
}: UsePreparationSpaceControllerOptions): PreparationSpaceContent {
  const safeProjectId = projectId ?? "";
  const { form } = preprocessWorkbenchState.useValue(safeProjectId);
  const workspace = useWorkspace(safeProjectId);
  const assets = useAssets(safeProjectId, {
    folderPaths: preprocessPreviewFolderPaths(form),
    limit: 6,
  });
  const operations = usePreprocessOperations(safeProjectId);
  const checkedCount = useWorkspaceSelectionStore((state) => state.checkedAssetIds.length);

  const project = useMemo(() => toPreparationProject(workspace.data), [workspace.data]);
  const samples = useMemo(
    () =>
      (assets.data?.items ?? []).map((asset) =>
        toPreparationAssetSample(
          asset,
          thumbnailUrl(safeProjectId, asset.id, asset.content_version, 520),
        ),
      ),
    [assets.data?.items, safeProjectId],
  );
  const projectedOperations = useMemo(
    () => projectPreparationOperations(operations.data ?? []),
    [operations.data],
  );
  const signals = useMemo(
    () => selectPreparationOperationSignals(projectedOperations),
    [projectedOperations],
  );

  const pending = workspace.isPending || assets.isPending || operations.isPending;
  const failed = workspace.isError || assets.isError || operations.isError;
  const message = workspace.isError
    ? describeError(workspace.error, "无法读取当前项目。")
    : assets.isError
      ? describeError(assets.error, "无法读取素材样本。")
      : operations.isError
        ? describeError(operations.error, "无法读取整备任务记录。")
        : projectId && !pending && !project
          ? "当前项目上下文已经失效，请返回项目档案重新装载。"
          : null;

  return {
    kind: "preparation",
    status: !projectId
      ? "no-context"
      : failed || (!pending && !project)
        ? "error"
        : pending
          ? "loading"
          : "ready",
    project,
    samples,
    checkedCount,
    activeOperation: signals.activeOperation,
    recentOperation: signals.recentOperation,
    recoverableOperation: signals.recoverableOperation,
    message,
    openArchive: onOpenArchive,
    openWorkbench: onOpenWorkbench,
    openOperation: onOpenOperation,
  };
}
