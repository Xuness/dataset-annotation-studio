import type {
  AnnotationOverview,
  AssetSummary,
  JobSummary,
  WorkspaceSummary,
} from "../../../../shared/api/types";
import {
  ANNOTATION_LANE_IDS,
  type AnnotationAssetSample,
  type AnnotationCoverageLane,
  type AnnotationLaneId,
  type AnnotationOperationSummary,
  type AnnotationProjectContext,
  type AnnotationTranslationVariant,
} from "../spacePageModel";

const ACTIVE_JOB_STATUSES = new Set(["queued", "running", "stopping"]);
const ATTENTION_JOB_STATUSES = new Set(["interrupted", "stopped", "completed_with_errors"]);

const JOB_STATUS_LABELS: Readonly<Record<string, string>> = {
  queued: "等待执行",
  running: "正在生产",
  stopping: "正在停止",
  stopped: "已经停止",
  interrupted: "执行中断",
  completed: "已经完成",
  completed_with_errors: "完成但有异常",
};

export function isAnnotationLaneId(value: unknown): value is AnnotationLaneId {
  return ANNOTATION_LANE_IDS.includes(value as AnnotationLaneId);
}

export { isAnnotationEditChannelId } from "./annotationEditModel";

export function toAnnotationProject(
  workspace: WorkspaceSummary | undefined,
): AnnotationProjectContext | null {
  if (!workspace || typeof workspace.project_id !== "string") return null;
  return {
    id: workspace.project_id,
    name: workspace.name,
    rootPath: workspace.root_path,
    exists: workspace.exists,
    assetCount: workspace.asset_count,
    annotatedCount: workspace.annotated_count,
    invalidCount: workspace.invalid_count,
  };
}

export function toAnnotationAssetSample(
  asset: AssetSummary,
  imageUrl: string,
  thumbnailUrl: string,
): AnnotationAssetSample {
  return {
    id: asset.id,
    filename: asset.filename,
    relativePath: asset.relative_path,
    width: asset.width,
    height: asset.height,
    imageUrl,
    thumbnailUrl,
    annotationStatus: asset.annotation_status,
    channelStatuses: asset.annotation_channels ?? {},
  };
}

function coveragePercent(usable: number, total: number): number {
  if (total <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round((usable / total) * 100)));
}

export function projectAnnotationCoverage(
  overview: AnnotationOverview | undefined,
): readonly AnnotationCoverageLane[] {
  const total = overview?.asset_count ?? 0;
  const channels = new Map((overview?.channels ?? []).map((channel) => [channel.channel, channel]));
  return ANNOTATION_LANE_IDS.map((id) => {
    const channel = channels.get(id);
    const usable = channel?.usable_asset_count ?? 0;
    return {
      id,
      activeDocumentCount: channel?.active_document_count ?? 0,
      presentAssetCount: channel?.present_asset_count ?? 0,
      usableAssetCount: usable,
      staleAssetCount: channel?.stale_asset_count ?? 0,
      invalidAssetCount: channel?.invalid_asset_count ?? 0,
      missingAssetCount: channel?.missing_asset_count ?? total,
      coveragePercent: coveragePercent(usable, total),
    };
  });
}

export function projectTranslationVariants(
  overview: AnnotationOverview | undefined,
): readonly AnnotationTranslationVariant[] {
  return (overview?.translation_variants ?? []).map((variant) => ({
    id: [variant.language, variant.translation_source_kind, variant.translation_producer_kind].join(
      ":",
    ),
    language: variant.language,
    sourceKind: variant.translation_source_kind,
    producerKind: variant.translation_producer_kind,
    displayName: variant.display_name,
    presentAssetCount: variant.present_asset_count,
    usableAssetCount: variant.usable_asset_count,
    staleAssetCount: variant.stale_asset_count,
    invalidAssetCount: variant.invalid_asset_count,
    missingAssetCount: variant.missing_asset_count,
  }));
}

function jobLane(job: JobSummary): AnnotationLaneId | null {
  if (job.kind === "translation") return "translation";
  return isAnnotationLaneId(job.output_channel) ? job.output_channel : null;
}

export function toAnnotationOperation(job: JobSummary): AnnotationOperationSummary {
  const total = Math.max(0, job.total);
  const unresolved = Math.max(0, job.pending) + Math.max(0, job.running);
  const completed = Math.min(total, Math.max(0, total - unresolved));
  const terminal = !ACTIVE_JOB_STATUSES.has(job.status);
  const progressPercent = total > 0 ? Math.round((completed / total) * 100) : terminal ? 100 : 0;
  return {
    id: job.id,
    kind: job.kind,
    lane: jobLane(job),
    status: job.status,
    statusLabel: JOB_STATUS_LABELS[job.status] ?? job.status,
    progressPercent: Math.min(100, Math.max(0, progressPercent)),
    completedItems: completed,
    totalItems: total,
    failedItems: Math.max(0, job.failed),
    targetLanguage: job.target_language ?? null,
    executionProfileName: job.execution_profile_name,
    model: job.model,
    createdAt: job.created_at,
    updatedAt: job.updated_at,
    active: ACTIVE_JOB_STATUSES.has(job.status),
  };
}

export function selectAnnotationOperation(
  jobs: readonly JobSummary[],
  requestedOperationId: string | null = null,
  requestedOperation: JobSummary | null = null,
): AnnotationOperationSummary | null {
  if (requestedOperationId) {
    const exact =
      (requestedOperation?.id === requestedOperationId ? requestedOperation : null) ??
      jobs.find((candidate) => candidate.id === requestedOperationId);
    return exact ? toAnnotationOperation(exact) : null;
  }
  const job =
    jobs.find((candidate) => ACTIVE_JOB_STATUSES.has(candidate.status)) ??
    jobs.find((candidate) => ATTENTION_JOB_STATUSES.has(candidate.status)) ??
    jobs[0];
  return job ? toAnnotationOperation(job) : null;
}
