import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { createInitialExportForm } from "../../../../application/exports/exportState";
import type {
  AlertInteraction,
  AlertRequest,
  ConfirmationRequest,
  ConfirmInteraction,
} from "../../../../application/interaction";
import { useExportController } from "../../../../application/exports/useExportController";
import type { DeliveryDialog, DeliveryWorkbenchContent, QualityFilterId } from "../spacePageModel";
import { toAnnotationProject } from "../annotation/annotationSpaceModel";
import {
  projectDeliveryManifest,
  projectDeliveryOperations,
  selectDeliveryOperationSignals,
  toDeliveryPreview,
} from "./deliverySpaceModel";

type PendingInteraction =
  | {
      kind: "confirm";
      request: ConfirmationRequest;
      resolve(accepted: boolean): void;
    }
  | {
      kind: "alert";
      request: AlertRequest;
      resolve(): void;
    };

interface UseDeliveryWorkbenchControllerOptions {
  projectId: string;
  initialOperationId: string | null;
  onOperationIdChange(operationId: string | null): void;
  onReturnToSpace(): void;
  onOpenQuality(filter?: QualityFilterId): void;
  onOpenArchive(): void;
}

function describeError(reason: unknown, fallback: string): string {
  return reason instanceof Error ? reason.message : fallback;
}

function presentDialog(pending: PendingInteraction): DeliveryDialog {
  if (pending.kind === "alert") {
    return {
      kind: "alert",
      title: pending.request.title ?? "提示",
      message: pending.request.message,
      tone: "default",
      confirmLabel: "知道了",
      cancelLabel: null,
    };
  }
  return {
    kind: "confirm",
    title: pending.request.title ?? "确认操作",
    message: pending.request.message,
    tone: pending.request.tone ?? "default",
    confirmLabel: pending.request.confirmLabel ?? "确认",
    cancelLabel: pending.request.cancelLabel ?? "取消",
  };
}

export function useDeliveryWorkbenchController({
  projectId,
  initialOperationId,
  onOperationIdChange,
  onReturnToSpace,
  onOpenQuality,
  onOpenArchive,
}: UseDeliveryWorkbenchControllerOptions): DeliveryWorkbenchContent {
  const [pendingInteraction, setPendingInteraction] = useState<PendingInteraction | null>(null);
  const interactionRef = useRef<PendingInteraction | null>(null);

  const confirm = useCallback<ConfirmInteraction>((request) => {
    const previous = interactionRef.current;
    if (previous?.kind === "confirm") previous.resolve(false);
    else previous?.resolve();
    return new Promise<boolean>((resolve) => {
      const pending: PendingInteraction = { kind: "confirm", request, resolve };
      interactionRef.current = pending;
      setPendingInteraction(pending);
    });
  }, []);

  const alert = useCallback<AlertInteraction>((request) => {
    const previous = interactionRef.current;
    if (previous?.kind === "confirm") previous.resolve(false);
    else previous?.resolve();
    return new Promise<void>((resolve) => {
      const pending: PendingInteraction = { kind: "alert", request, resolve };
      interactionRef.current = pending;
      setPendingInteraction(pending);
    });
  }, []);

  useEffect(
    () => () => {
      const pending = interactionRef.current;
      if (pending?.kind === "confirm") pending.resolve(false);
      else pending?.resolve();
      interactionRef.current = null;
    },
    [],
  );

  const controller = useExportController({ projectId, confirm, alert });
  const resetPreview = controller.resetPreview;
  const project = useMemo(
    () => toAnnotationProject(controller.workspace.data),
    [controller.workspace.data],
  );
  const operations = useMemo(
    () => projectDeliveryOperations(controller.operations),
    [controller.operations],
  );
  const signals = useMemo(() => selectDeliveryOperationSignals(operations), [operations]);
  const requestedOperation = initialOperationId
    ? (operations.find((operation) => operation.id === initialOperationId) ?? null)
    : null;
  const selectedOperation = initialOperationId ? requestedOperation : signals.activeOperation;
  const preview = toDeliveryPreview(controller.preview);
  const manifest =
    selectedOperation?.manifest ??
    projectDeliveryManifest(controller.form, controller.assetCount, controller.checkedCount);
  const operationMissing =
    Boolean(initialOperationId) && !controller.operationsPending && !requestedOperation;
  const operationError = controller.operationsError
    ? describeError(controller.operationsError, "无法读取交付记录。")
    : null;
  const workspaceError = controller.workspace.isError
    ? describeError(controller.workspace.error, "无法打开当前项目。")
    : null;
  const loading = controller.workspace.isPending || controller.operationsPending;

  const resolveDialog = useCallback((accepted: boolean) => {
    const pending = interactionRef.current;
    if (!pending) return;
    interactionRef.current = null;
    setPendingInteraction(null);
    if (pending.kind === "confirm") pending.resolve(accepted);
    else pending.resolve();
  }, []);

  const selectOperation = useCallback(
    (operationId: string | null) => {
      resetPreview();
      onOperationIdChange(operationId);
    },
    [onOperationIdChange, resetPreview],
  );

  const returnToSpec = useCallback(() => {
    resetPreview();
    onOperationIdChange(null);
  }, [onOperationIdChange, resetPreview]);

  const fatalError =
    workspaceError ??
    operationError ??
    (operationMissing ? "指定交付记录不存在，请返回交付入口重新选择。" : null);
  const error = controller.error ?? fatalError;
  const validScope = controller.form.scope === "all" || controller.checkedCount > 0;
  const selectionIdentities = controller.form.selections.map((selection) =>
    [
      selection.channel,
      selection.translation_source_kind ?? "",
      selection.translation_producer_kind ?? "",
      selection.language.trim().toLowerCase(),
    ].join(":"),
  );
  const canPreview = Boolean(
    controller.form.destinationPath &&
    validScope &&
    controller.form.selections.length &&
    controller.form.selections.every(
      (selection) => selection.channel !== "translation" || selection.language.trim(),
    ) &&
    new Set(selectionIdentities).size === selectionIdentities.length &&
    controller.form.formats.length &&
    !signals.activeOperation,
  );
  const canExport = Boolean(
    preview && !preview.blockingIssueCount && preview.totalItems && !signals.activeOperation,
  );

  return {
    kind: "delivery-workbench",
    status: fatalError || (!loading && !project) ? "error" : loading ? "loading" : "ready",
    project,
    phase: selectedOperation ? "materialize" : preview ? "preflight" : "spec",
    form: controller.form,
    manifest,
    assetCount: controller.assetCount,
    checkedCount: controller.checkedCount,
    preview,
    previewPending: controller.previewPending,
    exportPending: controller.exportPending,
    canPreview,
    canExport,
    operations,
    activeOperation: signals.activeOperation,
    selectedOperation,
    error,
    dialog: pendingInteraction ? presentDialog(pendingInteraction) : null,
    updateForm: controller.patchForm,
    chooseDestination: controller.chooseFolder,
    previewAction: controller.previewAction,
    startExport: controller.startExport,
    stopOperation: controller.stop,
    resumeOperation: controller.resume,
    openFolder: controller.openFolder,
    selectOperation,
    returnToSpec,
    resolveDialog,
    returnToSpace: onReturnToSpace,
    openQuality: onOpenQuality,
    openArchive: onOpenArchive,
  };
}

interface NoContextOptions {
  onReturnToSpace(): void;
  onOpenQuality(filter?: QualityFilterId): void;
  onOpenArchive(): void;
}

export function createNoContextDeliveryWorkbench({
  onReturnToSpace,
  onOpenQuality,
  onOpenArchive,
}: NoContextOptions): DeliveryWorkbenchContent {
  const form = createInitialExportForm();
  return {
    kind: "delivery-workbench",
    status: "no-context",
    project: null,
    phase: "spec",
    form,
    manifest: projectDeliveryManifest(form, 0, 0),
    assetCount: 0,
    checkedCount: 0,
    preview: null,
    previewPending: false,
    exportPending: false,
    canPreview: false,
    canExport: false,
    operations: [],
    activeOperation: null,
    selectedOperation: null,
    error: null,
    dialog: null,
    updateForm: () => undefined,
    chooseDestination: async () => undefined,
    previewAction: async () => undefined,
    startExport: async () => undefined,
    stopOperation: async () => undefined,
    resumeOperation: async () => undefined,
    openFolder: async () => undefined,
    selectOperation: () => undefined,
    returnToSpec: () => undefined,
    resolveDialog: () => undefined,
    returnToSpace: onReturnToSpace,
    openQuality: onOpenQuality,
    openArchive: onOpenArchive,
  };
}
