import type { ExportFormState } from "../../../../application/exports/exportState";
import type {
  ExportChannelSelection,
  ExportOperation,
  ExportPreview,
} from "../../../../shared/api/types";
import type {
  DeliveryManifestSummary,
  DeliveryOperationSummary,
  DeliveryPreviewSummary,
  DeliverySelectionSummary,
} from "../spacePageModel";

const ACTIVE_STATUSES = new Set(["queued", "running", "stopping"]);
const RECOVERABLE_STATUSES = new Set(["stopped", "interrupted"]);

const STATUS_PRESENTATION: Readonly<
  Record<
    string,
    {
      label: string;
      code: string;
      tone: DeliveryOperationSummary["tone"];
    }
  >
> = {
  queued: { label: "等待开始", code: "QUEUED", tone: "active" },
  running: { label: "正在写入", code: "RUNNING", tone: "active" },
  stopping: { label: "正在停止", code: "STOPPING", tone: "attention" },
  stopped: { label: "已停止", code: "STOPPED", tone: "attention" },
  interrupted: { label: "意外中断", code: "INTERRUPTED", tone: "attention" },
  completed: { label: "交付完成", code: "COMPLETED", tone: "success" },
  failed: { label: "交付失败", code: "FAILED", tone: "danger" },
};

const CHANNEL_PRESENTATION = {
  existing_annotation: {
    code: "LEG.00",
    label: "原有标注",
    detail: "项目首次扫描时导入的同名标注",
  },
  tags: { code: "TAG.01", label: "Tags", detail: "结构化标签与文本版本" },
  description: { code: "DSC.02", label: "LLM 描述", detail: "自然语言描述通道" },
  translation: { code: "TRN.03", label: "译文", detail: "语言、来源与生成方式" },
} as const;

function sourceLabel(source: ExportChannelSelection["translation_source_kind"]): string {
  return source === "tags" ? "Tags" : "描述";
}

function producerLabel(producer: ExportChannelSelection["translation_producer_kind"]): string {
  return producer === "local_dictionary" ? "本地词典" : "LLM";
}

function destinationName(path: string): string {
  const normalized = path.trim().replace(/[\\/]+$/u, "");
  if (!normalized) return "尚未选择目的地";
  return normalized.split(/[\\/]/u).at(-1) || normalized;
}

export function projectDeliverySelection(
  selection: ExportChannelSelection,
  index: number,
): DeliverySelectionSummary {
  const presentation = CHANNEL_PRESENTATION[selection.channel];
  const language = selection.language.trim();
  const detail =
    selection.channel === "translation"
      ? [
          language || "LANG?",
          sourceLabel(selection.translation_source_kind),
          producerLabel(selection.translation_producer_kind),
        ].join(" · ")
      : presentation.detail;
  return {
    id: [
      selection.channel,
      selection.translation_source_kind ?? "",
      selection.translation_producer_kind ?? "",
      language.toLowerCase(),
      index,
    ].join(":"),
    channel: selection.channel,
    code: presentation.code,
    label:
      selection.channel === "translation" && language
        ? `${presentation.label} / ${language}`
        : presentation.label,
    detail,
    revision: selection.revision,
    revisionLabel: selection.revision === "reviewed" ? "已人工复核版本" : "当前版本",
  };
}

export function hasDeliveryDraft(form: Readonly<ExportFormState>): boolean {
  const defaultSelection =
    form.selections.length === 1 &&
    form.selections[0]?.channel === "existing_annotation" &&
    form.selections[0].revision === "current";
  return Boolean(
    form.destinationPath.trim() ||
    form.scope !== "all" ||
    !defaultSelection ||
    form.formats.length !== 1 ||
    form.formats[0] !== "txt" ||
    form.packaging !== "directory",
  );
}

export function projectDeliveryManifest(
  form: Readonly<ExportFormState>,
  assetCount: number,
  checkedCount: number,
  options: { source?: DeliveryManifestSummary["source"]; draft?: boolean } = {},
): DeliveryManifestSummary {
  const itemCount = form.scope === "selected" ? checkedCount : assetCount;
  return {
    source: options.source ?? "draft",
    scope: form.scope,
    scopeLabel: form.scope === "selected" ? "工作台已选素材" : "当前项目",
    itemCount,
    selections: form.selections.map(projectDeliverySelection),
    formats: [...form.formats],
    formatLabel: form.formats.length
      ? form.formats.map((format) => format.toUpperCase()).join(" + ")
      : "未选择",
    packaging: form.packaging,
    packagingLabel: form.packaging === "zip" ? "ZIP 压缩包" : "文件夹",
    destinationPath: form.destinationPath,
    destinationLabel: destinationName(form.destinationPath),
    draft: options.draft ?? hasDeliveryDraft(form),
  };
}

function operationManifest(operation: ExportOperation): DeliveryManifestSummary {
  const snapshot = operation.configuration_snapshot;
  const form: ExportFormState = {
    scope: operation.scope,
    destinationPath: operation.destination_path,
    selections: snapshot.channels ?? [],
    formats: snapshot.formats ?? ["txt"],
    packaging: snapshot.packaging ?? "directory",
  };
  return projectDeliveryManifest(form, operation.total_items, operation.total_items, {
    source: "operation",
    draft: false,
  });
}

export function toDeliveryOperation(operation: ExportOperation): DeliveryOperationSummary {
  const presentation = STATUS_PRESENTATION[operation.status] ?? {
    label: operation.status,
    code: operation.status.toUpperCase(),
    tone: "idle" as const,
  };
  const rawProgress = operation.total_items
    ? Math.round((operation.completed_items / operation.total_items) * 100)
    : operation.status === "completed"
      ? 100
      : 0;
  const progressPercent = Math.max(
    0,
    Math.min(operation.status === "completed" ? 100 : 99, rawProgress),
  );
  return {
    id: operation.id,
    shortId: operation.id.slice(0, 8).toUpperCase(),
    status: operation.status,
    statusLabel: presentation.label,
    statusCode: presentation.code,
    tone: presentation.tone,
    createdAt: operation.created_at,
    completedAt: operation.completed_at ?? null,
    destinationPath: operation.destination_path,
    totalItems: operation.total_items,
    completedItems: Math.min(operation.completed_items, operation.total_items),
    progressPercent,
    totalBytes: operation.total_bytes,
    copiedBytes: Math.min(operation.copied_bytes, operation.total_bytes),
    warningCount: operation.warning_count,
    currentRelativePath: operation.current_relative_path ?? null,
    errorMessage: operation.error_message ?? null,
    canStop: operation.status === "queued" || operation.status === "running",
    canResume: RECOVERABLE_STATUSES.has(operation.status),
    canOpenFolder: Boolean(operation.destination_path),
    manifest: operationManifest(operation),
  };
}

export function projectDeliveryOperations(
  operations: readonly ExportOperation[],
): readonly DeliveryOperationSummary[] {
  return [...operations]
    .sort((left, right) => right.created_at.localeCompare(left.created_at))
    .map(toDeliveryOperation);
}

export function selectDeliveryOperationSignals(operations: readonly DeliveryOperationSummary[]): {
  activeOperation: DeliveryOperationSummary | null;
  recoverableOperation: DeliveryOperationSummary | null;
  recentOperation: DeliveryOperationSummary | null;
  focusOperation: DeliveryOperationSummary | null;
} {
  const activeOperation =
    operations.find((operation) => ACTIVE_STATUSES.has(operation.status)) ?? null;
  const recoverableOperation =
    operations.find((operation) => RECOVERABLE_STATUSES.has(operation.status)) ?? null;
  const recentOperation = operations[0] ?? null;
  return {
    activeOperation,
    recoverableOperation,
    recentOperation,
    focusOperation: activeOperation ?? recoverableOperation ?? recentOperation,
  };
}

export function toDeliveryPreview(
  preview: ExportPreview | undefined,
): DeliveryPreviewSummary | null {
  if (!preview) return null;
  return {
    token: preview.preview_token,
    totalItems: preview.total_items,
    usableCount: preview.usable_count,
    reviewedCount: preview.reviewed_count,
    unreviewedCount: preview.unreviewed_count,
    staleCount: preview.stale_count,
    missingCount: preview.missing_count,
    emptyCount: preview.empty_count,
    invalidCount: preview.invalid_count,
    encodingErrorCount: preview.encoding_error_count,
    warningCount: preview.warning_count,
    blockingIssueCount: preview.blocking_issue_count,
    blockingIssues: preview.blocking_issues ?? [],
    imageBytes: preview.image_bytes,
    annotationBytes: preview.annotation_bytes,
    truncated: preview.truncated,
    items: preview.items.map((item) => ({
      assetId: item.asset_id,
      sourceRelativePath: item.source_relative_path,
      targetImageName: item.target_image_name,
      targetAnnotationName: item.target_annotation_name,
      targetOutputs: item.target_outputs ?? [],
      annotationStatus: item.annotation_status,
      channelStatuses: item.channel_statuses ?? {},
      imageBytes: item.image_bytes,
      annotationBytes: item.annotation_bytes,
      warningCode: item.warning_code ?? null,
      warningMessage: item.warning_message ?? null,
      blockingIssue: item.blocking_issue ?? null,
    })),
  };
}
