import { useCallback, useEffect, useMemo } from "react";

import { useJobDetailController } from "../../../../application/jobs/useJobDetailController";
import { useNewJobController } from "../../../../application/jobs/useNewJobController";
import type { JobDetail, WorkspaceSummary } from "../../../../shared/api/types";
import type {
  AnnotationCoverageLane,
  AnnotationLaneId,
  AnnotationProductionBackendId,
  AnnotationProductionContent,
  AnnotationProductionSnapshotField,
} from "../spacePageModel";
import {
  ANNOTATION_PRODUCTION_LANGUAGE_OPTIONS,
  createProductionLaneReadings,
  productionBackendOptions,
  productionLaneForJob,
  projectProductionOperation,
} from "./annotationProductionModel";

interface UseAnnotationProductionControllerOptions {
  projectId: string;
  workspace: WorkspaceSummary | null;
  checkedAssetIds: readonly string[];
  channels: readonly AnnotationCoverageLane[];
  requestedLane: AnnotationLaneId | null;
  requestedOperationId: string | null;
  enabled: boolean;
  onLaneChange(lane: AnnotationLaneId): void;
  onOperationChange(operationId: string | null): void;
}

function queryMessage(reason: unknown, fallback: string): string {
  return reason instanceof Error ? reason.message : fallback;
}

function backendLabel(backend: AnnotationProductionBackendId): string {
  if (backend === "local_tagger") return "LOCAL TAGGER";
  if (backend === "local_dictionary") return "LOCAL DICTIONARY";
  return "MODEL PROVIDER";
}

export function useAnnotationProductionController({
  projectId,
  workspace,
  checkedAssetIds,
  channels,
  requestedLane,
  requestedOperationId,
  enabled,
  onLaneChange,
  onOperationChange,
}: UseAnnotationProductionControllerOptions): AnnotationProductionContent {
  const requestedConfigurationLane = requestedLane ?? "tags";
  const handleCreated = useCallback(
    (job: JobDetail) => onOperationChange(job.id),
    [onOperationChange],
  );
  const newJob = useNewJobController({
    projectId,
    workspace,
    checkedAssetIds,
    onCreated: handleCreated,
    enabled: enabled && !requestedOperationId,
  });
  const { setAnnotationBackend, setKind, setTranslationBackend } = newJob;
  const detail = useJobDetailController(
    projectId,
    enabled && requestedOperationId ? requestedOperationId : null,
  );

  useEffect(() => {
    if (!enabled || requestedOperationId) return;
    if (requestedConfigurationLane === "tags") {
      setKind("annotation");
      setAnnotationBackend("local_tagger");
    } else if (requestedConfigurationLane === "description") {
      setKind("annotation");
      setAnnotationBackend("provider");
    } else {
      setKind("translation");
    }
  }, [enabled, requestedConfigurationLane, requestedOperationId, setAnnotationBackend, setKind]);

  const operationJob = detail.job.data ?? null;
  const lane = operationJob ? productionLaneForJob(operationJob) : requestedConfigurationLane;
  const backend: AnnotationProductionBackendId =
    lane === "tags"
      ? "local_tagger"
      : lane === "description"
        ? "provider"
        : newJob.translationBackend;

  const selectLane = useCallback(
    (nextLane: AnnotationLaneId) => {
      if (nextLane === "tags") {
        setKind("annotation");
        setAnnotationBackend("local_tagger");
      } else if (nextLane === "description") {
        setKind("annotation");
        setAnnotationBackend("provider");
      } else {
        setKind("translation");
      }
      onLaneChange(nextLane);
    },
    [onLaneChange, setAnnotationBackend, setKind],
  );

  const setBackend = useCallback(
    (nextBackend: AnnotationProductionBackendId) => {
      if (lane !== "translation") return;
      if (nextBackend === "provider" || nextBackend === "local_dictionary") {
        setTranslationBackend(nextBackend);
      }
    },
    [lane, setTranslationBackend],
  );

  const providerProfileOptions = useMemo(
    () =>
      newJob.providerProfiles.data?.map((profile) => ({
        id: profile.id,
        label: profile.name,
        detail: `${profile.provider_type.toUpperCase()} · ${profile.models.length} MODEL`,
      })) ?? [],
    [newJob.providerProfiles.data],
  );
  const modelOptions = useMemo(
    () =>
      newJob.selectedProvider?.models.map((model) => ({
        id: model.model_id,
        label: model.model_id,
        detail:
          model.model_id === newJob.selectedProvider?.default_model_id
            ? "DEFAULT MODEL"
            : `${model.max_output_tokens.toLocaleString()} TOKEN`,
      })) ?? [],
    [newJob.selectedProvider],
  );
  const taggerProfileOptions = useMemo(
    () =>
      newJob.readyTaggerProfiles.map((profile) => ({
        id: profile.id,
        label: profile.name,
        detail: `${profile.installation_name ?? "LOCAL MODEL"} · ${profile.device.toUpperCase()}`,
      })),
    [newJob.readyTaggerProfiles],
  );
  const promptPresetOptions = useMemo(
    () =>
      (lane === "translation"
        ? newJob.translationPromptPresets.data
        : newJob.systemPresets.data
      )?.map((preset) => ({ id: preset.id, label: preset.name })) ?? [],
    [lane, newJob.systemPresets.data, newJob.translationPromptPresets.data],
  );

  const blockers = useMemo(() => {
    const issues: string[] = [];
    if (!workspace) issues.push("当前项目上下文不可用");
    if (newJob.scope === "selected" && checkedAssetIds.length === 0) {
      issues.push("素材范围尚未选择；请在下方胶片轨道标记素材");
    }
    if (backend === "local_tagger" && !newJob.selectedTaggerProfile) {
      issues.push("没有可执行的本地打标配置");
    }
    if (backend === "local_dictionary" && !newJob.dictionaryReady) {
      issues.push("本地 Tag 词典尚未就绪");
    }
    if (backend === "provider") {
      if (!newJob.selectedProvider) issues.push("尚未选择可用的模型连接");
      if (!newJob.providerModelId) issues.push("尚未选择任务模型");
      if (lane === "description" && newJob.promptConfigurationIssue) {
        issues.push(newJob.promptConfigurationIssue);
      }
      if (lane === "translation" && newJob.translationPromptIssue) {
        issues.push(newJob.translationPromptIssue);
      }
    }
    return [...new Set(issues)];
  }, [
    backend,
    checkedAssetIds.length,
    lane,
    newJob.dictionaryReady,
    newJob.promptConfigurationIssue,
    newJob.providerModelId,
    newJob.scope,
    newJob.selectedProvider,
    newJob.selectedTaggerProfile,
    newJob.translationPromptIssue,
    workspace,
  ]);

  const scopeCount =
    newJob.scope === "selected" ? checkedAssetIds.length : (workspace?.asset_count ?? 0);
  const snapshot = useMemo(() => {
    const fields: AnnotationProductionSnapshotField[] = [
      {
        id: "scope",
        label: "任务范围",
        value: newJob.scope === "selected" ? "选定素材" : "全项目",
        detail: `${scopeCount.toLocaleString()} MATERIAL`,
      },
      {
        id: "route",
        label: "生产线路",
        value: lane.toUpperCase(),
        detail: backendLabel(backend),
      },
    ];
    if (backend === "local_tagger") {
      fields.push({
        id: "executor",
        label: "执行配置",
        value: newJob.selectedTaggerProfile?.name ?? "未配置",
        detail: newJob.selectedTaggerProfile
          ? `${newJob.selectedTaggerProfile.categories.length} CATEGORY · ${
              newJob.selectedTaggerProfile.batch_size ?? "AUTO"
            } BATCH`
          : undefined,
        tone: newJob.selectedTaggerProfile ? "default" : "attention",
      });
    } else if (backend === "local_dictionary") {
      const enabledDictionaries =
        newJob.tagDictionaryLibrary.data?.installations.filter(
          (item) =>
            item.enabled && item.status === "ready" && item.language === newJob.targetLanguage,
        ).length ?? 0;
      fields.push({
        id: "executor",
        label: "本地词典",
        value: `${enabledDictionaries} 个启用词典`,
        detail: `${newJob.tagDictionaryLibrary.data?.override_count ?? 0} OVERRIDE`,
        tone: newJob.dictionaryReady ? "default" : "attention",
      });
    } else {
      fields.push(
        {
          id: "provider",
          label: "模型连接",
          value: newJob.selectedProvider?.name ?? "未选择",
          detail: newJob.selectedProvider?.provider_type.toUpperCase(),
          tone: newJob.selectedProvider ? "default" : "attention",
        },
        {
          id: "model",
          label: "固定模型",
          value: newJob.providerModelId || "未选择",
          tone: newJob.providerModelId ? "default" : "attention",
        },
      );
    }
    if (lane === "description") {
      fields.push({
        id: "prompt",
        label: "提示词快照",
        value: newJob.configuredSystemPreset?.name ?? "未配置",
        detail: workspace?.settings.use_tags_as_context ? "TAGS CONTEXT ON" : "TAGS CONTEXT OFF",
        tone: newJob.configuredSystemPreset ? "default" : "attention",
      });
    }
    if (lane === "translation") {
      fields.push(
        {
          id: "source",
          label: "翻译来源",
          value: newJob.translationSourceKind === "tags" ? "Tags" : "LLM 描述",
          detail: newJob.targetLanguage,
        },
        {
          id: "policy",
          label: "已有译文",
          value: newJob.translationPolicy.toUpperCase(),
          detail:
            backend === "provider"
              ? (newJob.configuredTranslationPrompt?.name ?? "PROMPT MISSING")
              : "LOCAL LOOKUP",
          tone:
            backend === "provider" && !newJob.configuredTranslationPrompt ? "attention" : "default",
        },
      );
    }
    return fields;
  }, [
    backend,
    lane,
    newJob.configuredSystemPreset,
    newJob.configuredTranslationPrompt,
    newJob.dictionaryReady,
    newJob.providerModelId,
    newJob.scope,
    newJob.selectedProvider,
    newJob.selectedTaggerProfile,
    newJob.tagDictionaryLibrary.data,
    newJob.targetLanguage,
    newJob.translationPolicy,
    newJob.translationSourceKind,
    scopeCount,
    workspace?.settings.use_tags_as_context,
  ]);

  const projectedOperation = useMemo(() => {
    if (!operationJob) return null;
    const reading = projectProductionOperation(operationJob, detail.exceptionItems);
    const actionPending =
      detail.stopPending || detail.resumePending || detail.retryPending || detail.acceptPending;
    return {
      ...reading,
      loadingMore: detail.job.isFetching,
      canLoadMore: detail.exceptionItems.length < detail.exceptionCount,
      canStop: detail.active,
      stopping: detail.stopping,
      canResume: detail.resumable,
      canRetry: operationJob.status === "completed_with_errors" && operationJob.failed > 0,
      actionPending,
      stop: () => detail.stop(operationJob.id),
      resume: () => detail.resume(operationJob.id),
      retry: () => detail.retry(operationJob.id),
      accept: (exceptionId: string) => detail.accept(operationJob.id, exceptionId),
      loadMore: () => detail.loadMore(detail.exceptionCount),
    };
  }, [detail, operationJob]);

  const configuring = enabled && !requestedOperationId;
  const configurationLoading =
    configuring &&
    (backend === "local_tagger"
      ? newJob.taggerLibrary.isPending
      : backend === "local_dictionary"
        ? newJob.tagDictionaryLibrary.isPending
        : newJob.providerProfiles.isPending ||
          (lane === "description"
            ? newJob.systemPresets.isPending
            : newJob.translationPromptPresets.isPending));
  const status: AnnotationProductionContent["status"] = !enabled
    ? "inactive"
    : requestedOperationId
      ? detail.job.isError && !operationJob
        ? "error"
        : operationJob
          ? "operation"
          : "loading"
      : configurationLoading
        ? "loading"
        : "configure";
  const message =
    newJob.error ??
    (detail.job.isError
      ? queryMessage(detail.job.error, "无法读取指定生产任务。")
      : newJob.providerProfiles.isError && backend === "provider"
        ? queryMessage(newJob.providerProfiles.error, "无法读取模型连接。")
        : newJob.taggerLibrary.isError && backend === "local_tagger"
          ? queryMessage(newJob.taggerLibrary.error, "无法读取本地打标器。")
          : newJob.tagDictionaryLibrary.isError && backend === "local_dictionary"
            ? queryMessage(newJob.tagDictionaryLibrary.error, "无法读取本地词典。")
            : null);

  return {
    status,
    entryIntent: requestedOperationId ? "operation" : requestedLane ? "lane" : "overview",
    lane,
    lanes: createProductionLaneReadings(channels, operationJob),
    configuration: {
      scope: newJob.scope,
      scopeCount,
      totalCount: workspace?.asset_count ?? 0,
      selectedCount: checkedAssetIds.length,
      backend,
      backendOptions: productionBackendOptions(lane),
      providerProfileId: newJob.providerProfileId,
      providerProfileOptions,
      modelId: newJob.providerModelId,
      modelOptions,
      taggerProfileId: newJob.taggerProfileId,
      taggerProfileOptions,
      promptPresetId:
        lane === "translation"
          ? newJob.translationPromptPresetId
          : (workspace?.settings.system_preset_id ?? ""),
      promptPresetOptions,
      targetLanguage: newJob.targetLanguage,
      targetLanguageOptions: ANNOTATION_PRODUCTION_LANGUAGE_OPTIONS,
      translationSource: newJob.translationSourceKind,
      translationPolicy: newJob.translationPolicy,
      snapshot,
      blockers,
      ready: newJob.ready && blockers.length === 0,
      pending: newJob.createPending,
      setScope: newJob.setScope,
      setBackend,
      setProviderProfile: newJob.setProviderProfileId,
      setModel: newJob.setProviderModelId,
      setTaggerProfile: newJob.setTaggerProfileId,
      setPromptPreset: newJob.setTranslationPromptPresetId,
      setTargetLanguage: newJob.setTargetLanguage,
      setTranslationSource: newJob.setTranslationSourceKind,
      setTranslationPolicy: newJob.setTranslationPolicy,
      create: newJob.createJob,
    },
    operation: projectedOperation,
    message,
    selectLane,
    createNew: () => onLaneChange(lane),
  };
}
