import { useCallback, useMemo, useState } from "react";

import { actionError } from "../../../../application/interaction";
import { exportWorkbenchState } from "../../../../application/exports/exportState";
import { useAssets } from "../../../../features/assets/hooks";
import { useExportOperations } from "../../../../features/exports/hooks";
import { useWorkspace } from "../../../../features/workspaces/hooks";
import { openLocalFolder } from "../../../../shared/desktop/openLocalFolder";
import { useWorkspaceSelectionStore } from "../../../../shared/store/workspaceSelectionStore";
import type { DeliverySpaceContent, QualityFilterId } from "../spacePageModel";
import { toAnnotationProject } from "../annotation/annotationSpaceModel";
import {
  projectDeliveryManifest,
  projectDeliveryOperations,
  selectDeliveryOperationSignals,
} from "./deliverySpaceModel";

interface UseDeliverySpaceControllerOptions {
  projectId: string | null;
  onOpenArchive(): void;
  onOpenQuality(filter?: QualityFilterId): void;
  onOpenWorkbench(operationId?: string): void;
}

function describeError(reason: unknown, fallback: string): string {
  return reason instanceof Error ? reason.message : fallback;
}

export function useDeliverySpaceController({
  projectId,
  onOpenArchive,
  onOpenQuality,
  onOpenWorkbench,
}: UseDeliverySpaceControllerOptions): DeliverySpaceContent {
  const safeProjectId = projectId ?? "";
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const workspace = useWorkspace(safeProjectId);
  const assets = useAssets(safeProjectId, { limit: 1 });
  const operations = useExportOperations(safeProjectId);
  const checkedCount = useWorkspaceSelectionStore((state) => state.checkedAssetIds.length);
  const { form } = exportWorkbenchState.useValue(safeProjectId);

  const project = useMemo(() => toAnnotationProject(workspace.data), [workspace.data]);
  const assetCount = assets.data?.total ?? workspace.data?.asset_count ?? 0;
  const draftManifest = useMemo(
    () => projectDeliveryManifest(form, assetCount, checkedCount),
    [assetCount, checkedCount, form],
  );
  const projectedOperations = useMemo(
    () => projectDeliveryOperations(operations.data ?? []),
    [operations.data],
  );
  const signals = useMemo(
    () => selectDeliveryOperationSignals(projectedOperations),
    [projectedOperations],
  );

  const pending = workspace.isPending || assets.isPending || operations.isPending;
  const failed = workspace.isError || assets.isError || operations.isError;
  const message = workspace.isError
    ? describeError(workspace.error, "无法读取当前项目。")
    : assets.isError
      ? describeError(assets.error, "无法读取交付范围。")
      : operations.isError
        ? describeError(operations.error, "无法读取交付记录。")
        : projectId && !pending && !project
          ? "当前项目上下文已经失效，请返回项目档案重新装载。"
          : actionMessage;

  const openFolder = useCallback(async (path: string) => {
    setActionMessage(null);
    try {
      await openLocalFolder(path);
    } catch (reason) {
      setActionMessage(actionError(reason, "无法打开交付结果。"));
    }
  }, []);

  return {
    kind: "delivery",
    status: !projectId
      ? "no-context"
      : failed || (!pending && !project)
        ? "error"
        : pending
          ? "loading"
          : "ready",
    project,
    checkedCount,
    manifest: signals.focusOperation?.manifest ?? draftManifest,
    operations: projectedOperations,
    focusOperation: signals.focusOperation,
    activeOperation: signals.activeOperation,
    message,
    openArchive: onOpenArchive,
    openQuality: onOpenQuality,
    openWorkbench: onOpenWorkbench,
    openFolder,
  };
}
