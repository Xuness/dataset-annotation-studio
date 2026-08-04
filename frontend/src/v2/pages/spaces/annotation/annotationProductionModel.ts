import type { JobDetail, JobItemDetail, JobKind } from "../../../../shared/api/types";
import type {
  AnnotationCoverageLane,
  AnnotationLaneId,
  AnnotationProductionException,
  AnnotationProductionLaneReading,
  AnnotationProductionOperation,
  AnnotationProductionOption,
  AnnotationProductionSnapshotField,
} from "../spacePageModel";

const ACTIVE_STATUSES = new Set(["queued", "running", "stopping"]);
const SUCCESS_STATUSES = new Set(["completed"]);
const ATTENTION_STATUSES = new Set(["stopped", "interrupted", "completed_with_errors"]);

const STATUS_LABELS: Readonly<Record<string, string>> = {
  queued: "等待执行",
  running: "正在生产",
  stopping: "正在停止",
  stopped: "已经停止",
  interrupted: "执行中断",
  completed: "生产完成",
  completed_with_errors: "完成但有异常",
};

export const ANNOTATION_PRODUCTION_LANE_META: Readonly<
  Record<AnnotationLaneId, { code: string; title: string; summary: string }>
> = {
  tags: {
    code: "TAG.01",
    title: "标签生产",
    summary: "本地视觉模型生成结构化标签修订",
  },
  description: {
    code: "DSC.02",
    title: "描述生产",
    summary: "视觉语言模型生成逐图语义描述",
  },
  translation: {
    code: "TRN.03",
    title: "译文生产",
    summary: "基于描述或标签生成目标语言译文",
  },
};

export const ANNOTATION_PRODUCTION_LANGUAGE_OPTIONS: readonly AnnotationProductionOption[] = [
  { id: "zh-CN", label: "简体中文", detail: "zh-CN" },
  { id: "zh-TW", label: "繁體中文", detail: "zh-TW" },
  { id: "en", label: "English", detail: "en" },
  { id: "ja", label: "日本語", detail: "ja" },
  { id: "ko", label: "한국어", detail: "ko" },
];

export function productionBackendOptions(
  lane: AnnotationLaneId,
): readonly AnnotationProductionOption[] {
  if (lane === "tags") {
    return [{ id: "local_tagger", label: "本地打标器", detail: "LOCAL VISION" }];
  }
  if (lane === "description") {
    return [{ id: "provider", label: "视觉语言模型", detail: "MODEL PROVIDER" }];
  }
  return [
    { id: "provider", label: "语言模型翻译", detail: "MODEL PROVIDER" },
    { id: "local_dictionary", label: "本地 Tag 词典", detail: "OFFLINE DICTIONARY" },
  ];
}

export function productionLaneForJob(
  job: Pick<JobDetail, "kind" | "output_channel" | "execution_backend">,
): AnnotationLaneId {
  if (job.kind === "translation") return "translation";
  if (job.output_channel === "tags" || job.execution_backend === "local_tagger") return "tags";
  return "description";
}

function coverageState(
  coverage: AnnotationCoverageLane | undefined,
): AnnotationProductionLaneReading["state"] {
  if (!coverage || coverage.presentAssetCount === 0) return "inactive";
  if (
    coverage.missingAssetCount > 0 ||
    coverage.staleAssetCount > 0 ||
    coverage.invalidAssetCount
  ) {
    return "attention";
  }
  return "ready";
}

export function createProductionLaneReadings(
  channels: readonly AnnotationCoverageLane[],
  operation: Pick<JobDetail, "kind" | "output_channel" | "execution_backend" | "status"> | null,
): readonly AnnotationProductionLaneReading[] {
  return (Object.keys(ANNOTATION_PRODUCTION_LANE_META) as AnnotationLaneId[]).map((id) => {
    const coverage = channels.find((candidate) => candidate.id === id);
    const operationLane = operation ? productionLaneForJob(operation) : null;
    const operationState =
      operationLane === id
        ? ACTIVE_STATUSES.has(operation!.status)
          ? "running"
          : SUCCESS_STATUSES.has(operation!.status)
            ? "complete"
            : ATTENTION_STATUSES.has(operation!.status)
              ? "attention"
              : null
        : null;
    return {
      id,
      ...ANNOTATION_PRODUCTION_LANE_META[id],
      coveragePercent: coverage?.coveragePercent ?? 0,
      usableAssetCount: coverage?.usableAssetCount ?? 0,
      missingAssetCount: coverage?.missingAssetCount ?? 0,
      state: operationState ?? coverageState(coverage),
    };
  });
}

function progressPercent(job: JobDetail): number {
  if (job.total <= 0) return ACTIVE_STATUSES.has(job.status) ? 0 : 100;
  const completed = Math.max(0, job.total - job.pending - job.running);
  return Math.min(100, Math.max(0, Math.round((completed / job.total) * 100)));
}

function operationTone(job: JobDetail): AnnotationProductionOperation["tone"] {
  if (ACTIVE_STATUSES.has(job.status)) return "active";
  if (SUCCESS_STATUSES.has(job.status)) return "success";
  if (ATTENTION_STATUSES.has(job.status)) return "attention";
  return "idle";
}

function diagnosticResponse(item: JobItemDetail): string | null {
  const attempts = [...(item.attempts ?? [])].reverse();
  return attempts.find((attempt) => attempt.response_content)?.response_content ?? null;
}

function canAccept(item: JobItemDetail): boolean {
  return Boolean(
    item.attempts?.some(
      (attempt) => attempt.status === "validation_failed" && attempt.response_content,
    ),
  );
}

export function toProductionException(item: JobItemDetail): AnnotationProductionException {
  const candidate = item.result_disposition === "candidate";
  return {
    id: item.id,
    assetId: item.asset_id,
    relativePath: item.relative_path,
    status: item.status,
    attemptCount: item.attempt_count,
    message: candidate
      ? "目标通道在执行期间发生变化，结果已转入候选修订。"
      : (item.last_error ?? "执行未返回可识别的错误信息。"),
    diagnostic: diagnosticResponse(item),
    candidate,
    canAccept: canAccept(item),
  };
}

function jobKindLabel(kind: JobKind, lane: AnnotationLaneId): string {
  if (kind === "translation") return "TRANSLATION REVISION";
  return lane === "tags" ? "TAG REVISION" : "DESCRIPTION REVISION";
}

export type AnnotationProductionOperationReading = Omit<
  AnnotationProductionOperation,
  | "loadingMore"
  | "canLoadMore"
  | "canStop"
  | "stopping"
  | "canResume"
  | "canRetry"
  | "actionPending"
  | "stop"
  | "resume"
  | "retry"
  | "accept"
  | "loadMore"
>;

export function projectProductionOperation(
  job: JobDetail,
  exceptions: readonly JobItemDetail[],
): AnnotationProductionOperationReading {
  const lane = productionLaneForJob(job);
  const snapshot: AnnotationProductionSnapshotField[] = [
    {
      id: "route",
      label: "输出线路",
      value: jobKindLabel(job.kind, lane),
      detail: job.output_channel.toUpperCase(),
    },
    {
      id: "executor",
      label: "执行配置",
      value: job.execution_profile_name,
      detail: job.execution_backend.toUpperCase(),
    },
    { id: "model", label: "固定模型", value: job.model || "LOCAL PIPELINE" },
    {
      id: "scope",
      label: "任务范围",
      value: job.scope === "selected" ? "选定素材" : "全项目",
      detail: `${job.total.toLocaleString()} MATERIAL`,
    },
  ];
  if (job.kind === "translation") {
    snapshot.push(
      {
        id: "source",
        label: "翻译来源",
        value: job.translation_source_kind === "tags" ? "Tags" : "LLM 描述",
      },
      {
        id: "language",
        label: "目标语言",
        value: job.target_language ?? "—",
        detail: job.translation_policy?.toUpperCase(),
      },
    );
  } else if (job.system_preset_name) {
    snapshot.push({
      id: "prompt",
      label: "提示词快照",
      value: job.system_preset_name,
      detail: job.use_tags_as_context ? "TAGS CONTEXT ON" : "TAGS CONTEXT OFF",
    });
  }

  return {
    id: job.id,
    lane,
    status: job.status,
    statusLabel: STATUS_LABELS[job.status] ?? job.status,
    tone: operationTone(job),
    progressPercent: progressPercent(job),
    total: job.total,
    pending: job.pending,
    running: job.running,
    succeeded: job.succeeded,
    failed: job.failed,
    skipped: job.skipped,
    candidates: job.candidate_results,
    manuallyAccepted: job.manually_accepted,
    executionProfile: job.execution_profile_name,
    model: job.model,
    outputChannel: job.output_channel,
    scopeLabel: job.scope === "selected" ? "选定素材" : "全项目",
    createdAt: job.created_at,
    updatedAt: job.updated_at,
    snapshot,
    exceptions: exceptions.map(toProductionException),
    exceptionCount: Math.max(0, job.failed) + Math.max(0, job.candidate_results),
  };
}
