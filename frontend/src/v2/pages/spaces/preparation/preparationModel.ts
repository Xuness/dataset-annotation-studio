import type {
  AssetSummary,
  PreprocessExecutionPlan,
  PreprocessOperation,
  PreprocessPreview,
  WorkspaceSummary,
} from "../../../../shared/api/types";
import {
  PREPARATION_CANVAS_NODE_IDS,
  PREPARATION_CAPABILITY_IDS,
  type PreparationAssetSample,
  type PreparationCanvasNodeId,
  type PreparationCapabilityId,
  type PreparationExecutionPlanSummary,
  type PreparationOperationSummary,
  type PreparationPreviewSummary,
  type PreparationProjectContext,
} from "../spacePageModel";

const CAPABILITY_IDS = new Set<PreparationCapabilityId>(PREPARATION_CAPABILITY_IDS);
const CANVAS_NODE_IDS = new Set<PreparationCanvasNodeId>(PREPARATION_CANVAS_NODE_IDS);

const ACTIVE_STATUSES = new Set(["running", "recovering"]);

const STATUS_LABELS: Readonly<Record<string, string>> = {
  running: "正在处理",
  recovering: "正在恢复",
  completed: "已完成",
  undone: "已撤销",
  failed: "失败",
};

const RESIZE_ALGORITHM_LABELS = {
  lanczos3: "LANCZOS 3",
  lanczos4: "LANCZOS 4",
  anime_low_halo: "二次元低光晕",
} as const;

export function isPreparationCapabilityId(value: unknown): value is PreparationCapabilityId {
  return typeof value === "string" && CAPABILITY_IDS.has(value as PreparationCapabilityId);
}

export function isPreparationCanvasNodeId(value: unknown): value is PreparationCanvasNodeId {
  return typeof value === "string" && CANVAS_NODE_IDS.has(value as PreparationCanvasNodeId);
}

export function toPreparationProject(
  workspace: WorkspaceSummary | undefined,
): PreparationProjectContext | null {
  if (!workspace || typeof workspace.project_id !== "string") return null;
  return {
    id: workspace.project_id,
    name: workspace.name,
    rootPath: workspace.root_path,
    exists: workspace.exists,
    assetCount: workspace.asset_count,
    invalidCount: workspace.invalid_count,
  };
}

export function toPreparationAssetSample(
  asset: AssetSummary,
  thumbnailUrl: string,
): PreparationAssetSample {
  return {
    id: asset.id,
    filename: asset.filename,
    relativePath: asset.relative_path,
    width: asset.width,
    height: asset.height,
    thumbnailUrl,
  };
}

function operationCapabilities(operation: PreprocessOperation): PreparationCapabilityId[] {
  const capabilities: PreparationCapabilityId[] = [];
  if (operation.options.resize) capabilities.push("geometry");
  if (operation.options.convert) capabilities.push("encoding");
  if (operation.options.rename) capabilities.push("identity");
  return capabilities;
}

function operationOptionSummary(operation: PreprocessOperation): string[] {
  const summary: string[] = [];
  if (operation.options.resize) {
    summary.push(
      `最长边 ${operation.options.resize.max_edge} · ${
        RESIZE_ALGORITHM_LABELS[operation.options.resize.algorithm]
      }${operation.options.resize.allow_upscale ? " · 允许放大" : ""}`,
    );
  }
  if (operation.options.convert) {
    summary.push(
      `${operation.options.convert.format.toUpperCase()} · Q${operation.options.convert.quality} · E${operation.options.convert.effort}`,
    );
  }
  if (operation.options.rename) {
    summary.push(
      `重命名 ${operation.options.rename.template} · 起始 ${operation.options.rename.start_index}`,
    );
  }
  return summary;
}

function operationProgress(operation: PreprocessOperation) {
  const total = Number.isFinite(operation.item_count) ? Math.max(0, operation.item_count) : 0;
  const rawCompleted = Number.isFinite(operation.completed_items)
    ? Math.max(0, operation.completed_items)
    : 0;
  const completed = Math.min(total, rawCompleted);
  const terminalSuccess = operation.status === "completed" || operation.status === "undone";
  let percent = total > 0 ? Math.round((completed / total) * 100) : 0;
  if (terminalSuccess) percent = 100;
  else if (ACTIVE_STATUSES.has(operation.status) && total > 0) percent = Math.min(percent, 99);
  return { total, completed, percent, determinate: total > 0 || terminalSuccess };
}

function operationStageLabel(
  operation: PreprocessOperation,
  completed: number,
  total: number,
): string {
  if (operation.status === "recovering") return "正在校验并恢复源版本";
  if (operation.status === "running") {
    if (completed <= 0) return "正在准备恢复副本与处理队列";
    if (completed < total) return "融合处理通道正在写入素材";
    return "处理完成，正在更新素材索引";
  }
  return STATUS_LABELS[operation.status] ?? operation.status;
}

function operationBackendLabel(operation: PreprocessOperation): string {
  if (operation.runtime?.backend_label) return operation.runtime.backend_label;
  if (operation.execution.mode === "prefer_accelerator") {
    return operation.execution.accelerator_id ?? "ACCELERATOR";
  }
  if (operation.execution.mode === "cpu_only") return "CPU";
  return "AUTO ROUTE";
}

export function toPreparationOperation(
  operation: PreprocessOperation,
  canRecover = false,
): PreparationOperationSummary {
  const progress = operationProgress(operation);
  return {
    id: operation.id,
    status: operation.status,
    statusLabel: STATUS_LABELS[operation.status] ?? operation.status,
    stageLabel: operationStageLabel(operation, progress.completed, progress.total),
    itemCount: progress.total,
    completedItems: progress.completed,
    progressPercent: progress.percent,
    determinate: progress.determinate,
    currentRelativePath: operation.current_relative_path ?? null,
    etaSeconds: operation.eta_seconds ?? null,
    createdAt: operation.created_at,
    completedAt: operation.completed_at ?? operation.undone_at ?? null,
    errorMessage: operation.error_message ?? null,
    capabilities: operationCapabilities(operation),
    optionSummary: operationOptionSummary(operation),
    backendLabel: operationBackendLabel(operation),
    canRecover: canRecover && operation.status === "completed",
  };
}

export function projectPreparationOperations(
  operations: readonly PreprocessOperation[],
): readonly PreparationOperationSummary[] {
  const activeOperation = operations.find((operation) => ACTIVE_STATUSES.has(operation.status));
  const latestCompleted = activeOperation
    ? null
    : operations.find((operation) => operation.status === "completed");
  return operations.map((operation) =>
    toPreparationOperation(operation, operation.id === latestCompleted?.id),
  );
}

export function selectPreparationOperationSignals(
  operations: readonly PreparationOperationSummary[],
) {
  const activeOperation =
    operations.find((operation) => ACTIVE_STATUSES.has(operation.status)) ?? null;
  const recentOperation =
    activeOperation ??
    operations.find((operation) => operation.status === "failed") ??
    operations[0] ??
    null;
  const recoverableOperation = operations.find((operation) => operation.canRecover) ?? null;
  return { activeOperation, recentOperation, recoverableOperation };
}

export function toPreparationPreview(
  preview: PreprocessPreview | undefined,
): PreparationPreviewSummary | null {
  if (!preview) return null;
  return {
    totalItems: preview.total_items,
    changedCount: preview.changed_count,
    unchangedCount: preview.unchanged_count,
    warningCount: preview.warning_count,
    truncated: preview.truncated,
    items: preview.items.slice(0, 12).map((item) => ({
      assetId: item.asset_id,
      beforeRelativePath: item.before_relative_path,
      afterRelativePath: item.after_relative_path,
      beforeWidth: item.before_width,
      beforeHeight: item.before_height,
      afterWidth: item.after_width,
      afterHeight: item.after_height,
      willChange: item.will_change,
      warning: item.warning ?? null,
    })),
  };
}

export function toPreparationExecutionPlan(
  plan: PreprocessExecutionPlan | undefined,
): PreparationExecutionPlanSummary | null {
  if (!plan) return null;
  return {
    backendId: plan.selected_backend_id,
    routeCounts: plan.route_counts,
    effectiveWorkers: plan.effective_cpu_workers,
    effectiveBatchSize: plan.effective_batch_size,
  };
}
