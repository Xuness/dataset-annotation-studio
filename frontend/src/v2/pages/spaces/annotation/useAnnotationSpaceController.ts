import { useMemo } from "react";

import { useAnnotationOverview } from "../../../../features/annotations/hooks";
import { thumbnailUrl } from "../../../../features/assets/api";
import { useAssets } from "../../../../features/assets/hooks";
import { useJobHistory } from "../../../../features/jobs/hooks";
import {
  useProviderProfiles,
  useSystemPresets,
  useTranslationPromptPresets,
} from "../../../../features/presets/hooks";
import { useTagDictionaryLibrary } from "../../../../features/tagDictionaries/hooks";
import { useTaggerLibrary } from "../../../../features/taggers/hooks";
import { useWorkspace } from "../../../../features/workspaces/hooks";
import { useWorkspaceSelectionStore } from "../../../../shared/store/workspaceSelectionStore";
import type {
  AnnotationContextSignal,
  AnnotationContextSignalId,
  AnnotationLaneId,
  AnnotationSpaceContent,
} from "../spacePageModel";
import {
  projectAnnotationCoverage,
  projectTranslationVariants,
  selectAnnotationOperation,
  toAnnotationAssetSample,
  toAnnotationProject,
} from "./annotationSpaceModel";

interface UseAnnotationSpaceControllerOptions {
  projectId: string | null;
  onOpenArchive(): void;
  onOpenWorkbench(assetId?: string, lane?: AnnotationLaneId): void;
  onOpenProduction(lane?: AnnotationLaneId, operationId?: string): void;
}

interface QuerySignalOptions {
  id: AnnotationContextSignalId;
  pending: boolean;
  failed: boolean;
  count: number;
  readyValue: string;
  readyDetail: string;
  missingValue: string;
  missingDetail: string;
}

function describeError(reason: unknown, fallback: string): string {
  return reason instanceof Error ? reason.message : fallback;
}

function querySignal({
  id,
  pending,
  failed,
  count,
  readyValue,
  readyDetail,
  missingValue,
  missingDetail,
}: QuerySignalOptions): AnnotationContextSignal {
  if (pending) return { id, state: "loading", value: "正在读取", detail: "能力索引尚未完成装载。" };
  if (failed) return { id, state: "error", value: "读取失败", detail: "无法确认当前能力状态。" };
  if (count > 0) return { id, state: "ready", value: readyValue, detail: readyDetail };
  return { id, state: "attention", value: missingValue, detail: missingDetail };
}

export function useAnnotationSpaceController({
  projectId,
  onOpenArchive,
  onOpenWorkbench,
  onOpenProduction,
}: UseAnnotationSpaceControllerOptions): AnnotationSpaceContent {
  const safeProjectId = projectId ?? "";
  const hasContext = Boolean(projectId);
  const workspace = useWorkspace(safeProjectId);
  const assets = useAssets(safeProjectId, { limit: 7 });
  const overview = useAnnotationOverview(safeProjectId);
  const jobs = useJobHistory(safeProjectId, 20);
  const systemPresets = useSystemPresets(hasContext);
  const providers = useProviderProfiles(hasContext);
  const taggers = useTaggerLibrary(hasContext);
  const translationPrompts = useTranslationPromptPresets(hasContext);
  const dictionaries = useTagDictionaryLibrary(hasContext);
  const checkedCount = useWorkspaceSelectionStore((state) => state.checkedAssetIds.length);

  const project = useMemo(() => toAnnotationProject(workspace.data), [workspace.data]);
  const samples = useMemo(
    () =>
      (assets.data?.items ?? []).map((asset) =>
        toAnnotationAssetSample(
          asset,
          thumbnailUrl(safeProjectId, asset.id, asset.content_version, 1024),
          thumbnailUrl(safeProjectId, asset.id, asset.content_version, 420),
        ),
      ),
    [assets.data?.items, safeProjectId],
  );
  const channels = useMemo(() => projectAnnotationCoverage(overview.data), [overview.data]);
  const translationVariants = useMemo(
    () => projectTranslationVariants(overview.data),
    [overview.data],
  );
  const operation = useMemo(
    () => selectAnnotationOperation(jobs.data?.pages.flat() ?? []),
    [jobs.data?.pages],
  );

  const contextSignals = useMemo<readonly AnnotationContextSignal[]>(() => {
    if (!workspace.data) return [];
    const settings = workspace.data.settings;
    const selectedPreset = systemPresets.data?.find(
      (preset) => preset.id === settings.system_preset_id,
    );
    const readyTaggers = taggers.data?.profiles.filter((profile) => profile.ready).length ?? 0;
    const readyDictionaries =
      dictionaries.data?.installations?.filter(
        (installation) => installation.enabled && installation.status === "ready",
      ).length ?? 0;
    return [
      systemPresets.isPending
        ? {
            id: "system-prompt",
            state: "loading",
            value: "正在读取",
            detail: "正在核对项目使用的 System Prompt。",
          }
        : systemPresets.isError
          ? {
              id: "system-prompt",
              state: "error",
              value: "读取失败",
              detail: "无法确认项目 Prompt 预设。",
            }
          : selectedPreset
            ? {
                id: "system-prompt",
                state: "ready",
                value: selectedPreset.name,
                detail: "项目已绑定可用的 System Prompt 预设。",
              }
            : {
                id: "system-prompt",
                state: "attention",
                value: settings.system_preset_id ? "预设已失效" : "尚未指定",
                detail: settings.system_preset_id
                  ? "项目引用的 Prompt 已不在能力库中。"
                  : "创建 LLM 描述任务前需要选择 System Prompt。",
              },
      {
        id: "user-context",
        state: settings.user_prompt.trim() ? "ready" : "attention",
        value: settings.user_prompt.trim() ? "已配置" : "空白",
        detail: settings.user_prompt.trim()
          ? "项目级用户上下文会进入描述生产快照。"
          : "当前没有项目级补充说明。",
      },
      {
        id: "tags-context",
        state: "ready",
        value: settings.use_tags_as_context ? "已启用" : "未启用",
        detail: settings.use_tags_as_context
          ? "Tags 将作为描述任务的附加上下文。"
          : "描述任务不会自动附加 Tags。",
      },
      {
        id: "json-fields",
        state: "ready",
        value: `${settings.json_fields?.length ?? 0} 个字段`,
        detail: settings.json_fields?.length
          ? "已选择的元数据字段会进入请求上下文。"
          : "当前请求不附加 JSON 元数据字段。",
      },
      querySignal({
        id: "provider",
        pending: providers.isPending,
        failed: providers.isError,
        count: providers.data?.length ?? 0,
        readyValue: `${providers.data?.length ?? 0} 个配置`,
        readyDetail: "可用于描述与 LLM 翻译生产。",
        missingValue: "没有配置",
        missingDetail: "描述与 LLM 翻译线路尚无 Provider。",
      }),
      querySignal({
        id: "tagger",
        pending: taggers.isPending,
        failed: taggers.isError,
        count: readyTaggers,
        readyValue: `${readyTaggers} 个就绪配置`,
        readyDetail: "本地 Tags 生产线路可以建立。",
        missingValue: "没有就绪配置",
        missingDetail: "需要在能力库安装模型并建立 Tagger 配置。",
      }),
      querySignal({
        id: "translation-prompt",
        pending: translationPrompts.isPending,
        failed: translationPrompts.isError,
        count: translationPrompts.data?.length ?? 0,
        readyValue: `${translationPrompts.data?.length ?? 0} 个预设`,
        readyDetail: "LLM 翻译线路具有可选 Prompt。",
        missingValue: "没有预设",
        missingDetail: "创建 LLM 翻译任务前需要翻译 Prompt。",
      }),
      querySignal({
        id: "dictionary",
        pending: dictionaries.isPending,
        failed: dictionaries.isError,
        count: readyDictionaries,
        readyValue: `${readyDictionaries} 个已启用词典`,
        readyDetail: "本地 Tags 词典翻译线路可以建立。",
        missingValue: "没有可用词典",
        missingDetail: "本地词典翻译线路尚未就绪。",
      }),
    ];
  }, [
    dictionaries.data?.installations,
    dictionaries.isError,
    dictionaries.isPending,
    providers.data,
    providers.isError,
    providers.isPending,
    systemPresets.data,
    systemPresets.isError,
    systemPresets.isPending,
    taggers.data?.profiles,
    taggers.isError,
    taggers.isPending,
    translationPrompts.data,
    translationPrompts.isError,
    translationPrompts.isPending,
    workspace.data,
  ]);

  const corePending = workspace.isPending || assets.isPending || overview.isPending;
  const coreFailed = workspace.isError || assets.isError || overview.isError;
  const message = workspace.isError
    ? describeError(workspace.error, "无法读取当前项目。")
    : assets.isError
      ? describeError(assets.error, "无法读取素材样本。")
      : overview.isError
        ? describeError(overview.error, "无法读取标注生产概览。")
        : projectId && !corePending && !project
          ? "当前项目上下文已经失效，请返回项目档案重新装载。"
          : jobs.isError
            ? describeError(jobs.error, "无法读取最近的生产任务。")
            : null;

  return {
    kind: "annotation",
    status: !projectId
      ? "no-context"
      : coreFailed || (!corePending && !project)
        ? "error"
        : corePending
          ? "loading"
          : "ready",
    project,
    samples,
    checkedCount,
    channels,
    translationVariants,
    contextSignals,
    operation,
    message,
    openArchive: onOpenArchive,
    openWorkbench: onOpenWorkbench,
    openProduction: onOpenProduction,
  };
}
