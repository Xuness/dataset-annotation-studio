import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { ConfirmationRequest, ConfirmInteraction } from "../../../../application/interaction";
import { createInitialPreprocessForm } from "../../../../application/preprocessing/preprocessState";
import { usePreprocessController } from "../../../../application/preprocessing/usePreprocessController";
import { thumbnailUrl } from "../../../../features/assets/api";
import { useAssets } from "../../../../features/assets/hooks";
import type {
  PreparationCanvasNodeId,
  PreparationConfirmation,
  PreparationWorkbenchContent,
} from "../spacePageModel";
import {
  projectPreparationOperations,
  selectPreparationOperationSignals,
  toPreparationAssetSample,
  toPreparationExecutionPlan,
  toPreparationPreview,
  toPreparationProject,
} from "./preparationModel";

interface PendingConfirmation {
  request: ConfirmationRequest;
  resolve(accepted: boolean): void;
}

interface UsePreparationWorkbenchControllerOptions {
  projectId: string;
  initialFocus: PreparationCanvasNodeId;
  initialOperationId: string | null;
  onOperationIdChange(operationId: string | null): void;
  onReturnToSpace(): void;
  onOpenArchive(): void;
}

function describeError(reason: unknown, fallback: string): string {
  return reason instanceof Error ? reason.message : fallback;
}

function presentConfirmation(request: ConfirmationRequest): PreparationConfirmation {
  return {
    title: request.title ?? "确认操作",
    message: request.message,
    tone: request.tone ?? "default",
    confirmLabel: request.confirmLabel ?? "确认",
    cancelLabel: request.cancelLabel ?? "取消",
  };
}

export function usePreparationWorkbenchController({
  projectId,
  initialFocus,
  initialOperationId,
  onOperationIdChange,
  onReturnToSpace,
  onOpenArchive,
}: UsePreparationWorkbenchControllerOptions): PreparationWorkbenchContent {
  const [pendingConfirmation, setPendingConfirmation] = useState<PendingConfirmation | null>(null);
  const confirmationRef = useRef<PendingConfirmation | null>(null);
  const appliedOperationRef = useRef<string | null>(null);

  const confirm = useCallback<ConfirmInteraction>((request) => {
    confirmationRef.current?.resolve(false);
    return new Promise<boolean>((resolve) => {
      const pending = { request, resolve };
      confirmationRef.current = pending;
      setPendingConfirmation(pending);
    });
  }, []);

  useEffect(
    () => () => {
      confirmationRef.current?.resolve(false);
      confirmationRef.current = null;
    },
    [],
  );

  const controller = usePreprocessController({
    projectId,
    rescanPending: false,
    confirm,
  });
  const {
    operations: sourceOperations,
    selectedOperation: sourceSelectedOperation,
    setSelectedOperationId,
  } = controller;
  const assets = useAssets(projectId, { limit: 5 });
  const project = useMemo(
    () => toPreparationProject(controller.workspace.data),
    [controller.workspace.data],
  );
  const samples = useMemo(
    () =>
      (assets.data?.items ?? []).map((asset) =>
        toPreparationAssetSample(
          asset,
          thumbnailUrl(projectId, asset.id, asset.content_version, 640),
        ),
      ),
    [assets.data?.items, projectId],
  );
  const operations = useMemo(
    () => projectPreparationOperations(sourceOperations),
    [sourceOperations],
  );
  const signals = useMemo(() => selectPreparationOperationSignals(operations), [operations]);

  useEffect(() => {
    if (!initialOperationId || appliedOperationRef.current === initialOperationId) return;
    if (!sourceOperations.some((operation) => operation.id === initialOperationId)) return;
    appliedOperationRef.current = initialOperationId;
    setSelectedOperationId(initialOperationId);
  }, [initialOperationId, setSelectedOperationId, sourceOperations]);

  const selectedOperation = sourceSelectedOperation
    ? (operations.find((operation) => operation.id === sourceSelectedOperation.id) ?? null)
    : null;

  const resolveConfirmation = useCallback((accepted: boolean) => {
    const pending = confirmationRef.current;
    if (!pending) return;
    confirmationRef.current = null;
    setPendingConfirmation(null);
    pending.resolve(accepted);
  }, []);

  const selectOperation = useCallback(
    (operationId: string | null) => {
      appliedOperationRef.current = operationId;
      setSelectedOperationId(operationId);
      onOperationIdChange(operationId);
    },
    [onOperationIdChange, setSelectedOperationId],
  );

  const workspaceError = controller.workspace.isError
    ? describeError(controller.workspace.error, "无法打开当前项目。")
    : null;
  const assetError = assets.isError ? describeError(assets.error, "无法读取素材证据。") : null;
  const loading = controller.workspace.isPending || assets.isPending;

  return {
    kind: "preparation-workbench",
    status:
      workspaceError || assetError || (!loading && !project)
        ? "error"
        : loading
          ? "loading"
          : "ready",
    project,
    samples,
    initialFocus,
    form: controller.form,
    assetCount: controller.assetCount,
    checkedCount: controller.checkedCount,
    preview: toPreparationPreview(controller.preview),
    previewPending: controller.previewPending,
    executionPlan: toPreparationExecutionPlan(controller.executionPlan),
    executionPlanPending: controller.executionPlanPending,
    executionPlanError: controller.executionPlanError,
    backends:
      controller.backends?.backends.map((backend) => ({
        id: backend.id,
        label: backend.label,
        status: backend.status,
        deviceName: backend.device_name ?? null,
      })) ?? [],
    backendsPending: controller.backendsPending,
    operations,
    activeOperation: signals.activeOperation,
    selectedOperation,
    workspaceBusy: controller.workspaceBusy,
    error: controller.error ?? workspaceError ?? assetError,
    confirmation: pendingConfirmation ? presentConfirmation(pendingConfirmation.request) : null,
    updateForm: controller.patchForm,
    previewAction: controller.previewAction,
    executeAction: controller.executeAction,
    selectOperation,
    undoAction: controller.undoAction,
    resolveConfirmation,
    returnToSpace: onReturnToSpace,
    openArchive: onOpenArchive,
  };
}

interface NoContextOptions {
  initialFocus: PreparationCanvasNodeId;
  onReturnToSpace(): void;
  onOpenArchive(): void;
}

export function createNoContextPreparationWorkbench({
  initialFocus,
  onReturnToSpace,
  onOpenArchive,
}: NoContextOptions): PreparationWorkbenchContent {
  return {
    kind: "preparation-workbench",
    status: "no-context",
    project: null,
    samples: [],
    initialFocus,
    form: createInitialPreprocessForm(),
    assetCount: 0,
    checkedCount: 0,
    preview: null,
    previewPending: false,
    executionPlan: null,
    executionPlanPending: false,
    executionPlanError: null,
    backends: [],
    backendsPending: false,
    operations: [],
    activeOperation: null,
    selectedOperation: null,
    workspaceBusy: false,
    error: null,
    confirmation: null,
    updateForm: () => undefined,
    previewAction: async () => undefined,
    executeAction: async () => undefined,
    selectOperation: () => undefined,
    undoAction: async () => undefined,
    resolveConfirmation: () => undefined,
    returnToSpace: onReturnToSpace,
    openArchive: onOpenArchive,
  };
}
