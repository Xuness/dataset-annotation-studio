import { useCallback, useEffect, useMemo, useState } from "react";

import { useAssetFolders, useAssetIds, useCandidateSummary } from "../../features/assets/hooks";
import { useJobActions } from "../../features/jobs/hooks";
import {
  useProviderProfiles,
  useSystemPresets,
  useTranslationPromptPresets,
} from "../../features/presets/hooks";
import { useTagDictionaryLibrary } from "../../features/tagDictionaries/hooks";
import { useTaggerLibrary } from "../../features/taggers/hooks";
import type {
  ExistingTranslationPolicy,
  ExecutionBackend,
  JobDetail,
  JobKind,
  TranslationSourceKind,
  WorkspaceSummary,
} from "../../shared/api/types";
import {
  folderSelectionsEqual,
  reconcileFolderSelection,
  toggleFolderSelection,
} from "../../shared/store/folderSelection";
import { actionError } from "../interaction";

interface UseNewJobControllerOptions {
  projectId: string;
  workspace: WorkspaceSummary | null;
  checkedAssetIds: readonly string[];
  onCreated: (job: JobDetail) => void;
  enabled?: boolean;
}

type NewJobScope = "all" | "selected" | "folder";

export function useNewJobController({
  projectId,
  workspace,
  checkedAssetIds,
  onCreated,
  enabled = true,
}: UseNewJobControllerOptions) {
  const systemPresets = useSystemPresets(enabled);
  const translationPromptPresets = useTranslationPromptPresets(enabled);
  const providerProfiles = useProviderProfiles(enabled);
  const taggerLibrary = useTaggerLibrary(enabled);
  const tagDictionaryLibrary = useTagDictionaryLibrary(enabled);
  const candidateSummary = useCandidateSummary(projectId);
  const actions = useJobActions(projectId);
  const [kind, setKind] = useState<JobKind>("annotation");
  const [annotationBackend, setAnnotationBackend] = useState<ExecutionBackend>("provider");
  const [translationBackend, setTranslationBackend] = useState<"provider" | "local_dictionary">(
    "provider",
  );
  const [providerProfileId, setProviderProfileId] = useState("");
  const [providerModelId, setProviderModelId] = useState("");
  const [taggerProfileId, setTaggerProfileId] = useState("");
  const [translationPromptPresetId, setTranslationPromptPresetId] = useState("");
  const [scope, setScope] = useState<NewJobScope>("all");
  const [folderPaths, setFolderPaths] = useState<readonly string[]>([]);
  const [targetLanguage, setTargetLanguage] = useState("zh-CN");
  const [translationSourceKind, setTranslationSourceKind] =
    useState<TranslationSourceKind>("description");
  const [translationPolicy, setTranslationPolicy] = useState<ExistingTranslationPolicy>("skip");
  const [error, setError] = useState<string | null>(null);
  const folderLibrary = useAssetFolders(projectId, enabled);
  const folderOptions = useMemo(
    () =>
      folderLibrary.data?.items
        .filter((folder) => Boolean(folder.path))
        .map((folder) => ({
          id: folder.path,
          label: folder.name,
          detail: `${folder.descendant_asset_count.toLocaleString()} MATERIAL · ${folder.path}`,
        })) ?? [],
    [folderLibrary.data?.items],
  );
  const folderAssetIds = useAssetIds(
    projectId,
    { folderPaths },
    enabled && scope === "folder" && folderPaths.length > 0,
  );
  const refetchFolderAssetIds = folderAssetIds.refetch;
  const folderCount = folderAssetIds.data?.total ?? 0;
  const executionBackend = kind === "translation" ? translationBackend : annotationBackend;
  const selectedProvider = providerProfiles.data?.find(
    (profile) => profile.id === providerProfileId,
  );
  const readyTaggerProfiles = useMemo(
    () => taggerLibrary.data?.profiles.filter((profile) => profile.ready) ?? [],
    [taggerLibrary.data?.profiles],
  );
  const selectedTaggerProfile = readyTaggerProfiles.find(
    (profile) => profile.id === taggerProfileId,
  );

  useEffect(() => {
    const reconciled = reconcileFolderSelection(
      folderPaths,
      folderOptions.map((folder) => folder.id),
    );
    if (!folderSelectionsEqual(folderPaths, reconciled)) setFolderPaths(reconciled);
  }, [folderOptions, folderPaths]);

  const toggleFolderPath = useCallback(
    (folderPath: string) => setFolderPaths((current) => toggleFolderSelection(current, folderPath)),
    [],
  );
  const clearFolderPaths = useCallback(() => setFolderPaths([]), []);

  useEffect(() => {
    const available = providerProfiles.data;
    if (!available?.length) {
      if (providerProfileId) setProviderProfileId("");
      return;
    }
    if (!available.some((profile) => profile.id === providerProfileId)) {
      setProviderProfileId(available[0].id);
    }
  }, [providerProfileId, providerProfiles.data]);

  useEffect(() => {
    if (!selectedProvider) {
      if (providerModelId) setProviderModelId("");
      return;
    }
    if (!selectedProvider.models.some((model) => model.model_id === providerModelId)) {
      setProviderModelId(selectedProvider.default_model_id);
    }
  }, [providerModelId, selectedProvider]);

  useEffect(() => {
    if (!readyTaggerProfiles.length) {
      if (taggerProfileId) setTaggerProfileId("");
      return;
    }
    if (!readyTaggerProfiles.some((profile) => profile.id === taggerProfileId)) {
      setTaggerProfileId(readyTaggerProfiles[0].id);
    }
  }, [readyTaggerProfiles, taggerProfileId]);

  useEffect(() => {
    const available = translationPromptPresets.data;
    if (!available?.length) {
      if (translationPromptPresetId) setTranslationPromptPresetId("");
      return;
    }
    if (!available.some((preset) => preset.id === translationPromptPresetId)) {
      setTranslationPromptPresetId(available[0].id);
    }
  }, [translationPromptPresetId, translationPromptPresets.data]);

  useEffect(() => {
    if (translationBackend !== "local_dictionary") return;
    if (translationSourceKind !== "tags") setTranslationSourceKind("tags");
    if (targetLanguage !== "zh-CN") setTargetLanguage("zh-CN");
  }, [targetLanguage, translationBackend, translationSourceKind]);

  const configuredSystemPreset = systemPresets.data?.find(
    (preset) => preset.id === workspace?.settings.system_preset_id,
  );
  const promptConfigurationIssue = !workspace
    ? "当前项目上下文不可用"
    : !workspace.settings.system_preset_id
      ? "尚未在素材页选择 System Prompt 预设"
      : systemPresets.isError
        ? "无法读取项目关联的 System Prompt 预设"
        : systemPresets.isSuccess && !configuredSystemPreset
          ? "项目关联的 System Prompt 预设已不存在"
          : null;
  const configuredTranslationPrompt = translationPromptPresets.data?.find(
    (preset) => preset.id === translationPromptPresetId,
  );
  const translationPromptIssue = translationPromptPresets.isError
    ? "无法读取翻译 Prompt 预设"
    : translationPromptPresets.isSuccess && !configuredTranslationPrompt
      ? "尚未创建可用的翻译 Prompt 预设"
      : null;
  const providerReady = Boolean(
    selectedProvider && selectedProvider.models.some((model) => model.model_id === providerModelId),
  );
  const promptReady = kind === "translation" ? configuredTranslationPrompt : configuredSystemPreset;
  const dictionaryReady = Boolean(
    tagDictionaryLibrary.data &&
    (tagDictionaryLibrary.data.override_count > 0 ||
      tagDictionaryLibrary.data.installations.some(
        (item) => item.enabled && item.status === "ready" && item.language === targetLanguage,
      )),
  );
  const ready = Boolean(
    workspace &&
    (executionBackend === "local_tagger"
      ? selectedTaggerProfile
      : executionBackend === "local_dictionary"
        ? dictionaryReady
        : providerReady && promptReady) &&
    (scope === "all" ||
      (scope === "selected" && checkedAssetIds.length > 0) ||
      (scope === "folder" && folderPaths.length > 0 && folderCount > 0 && !folderAssetIds.isError)),
  );

  const createJob = useCallback(async () => {
    setError(null);
    try {
      if (!workspace) throw new Error("当前项目上下文不可用。");
      const providerExecution = executionBackend === "provider";
      const taggerExecution = executionBackend === "local_tagger";
      let scopedAssetIds: string[] = [];
      if (scope === "selected") {
        scopedAssetIds = [...checkedAssetIds];
      } else if (scope === "folder") {
        if (!folderPaths.length) throw new Error("请至少选择一个工作目录下的素材子文件夹。");
        const result = await refetchFolderAssetIds();
        if (result.error) throw result.error;
        scopedAssetIds = result.data?.ids ?? [];
        if (!scopedAssetIds.length) throw new Error("所选子文件夹范围中没有可处理的素材。");
      }
      const job = await actions.create.mutateAsync({
        execution_backend: executionBackend,
        provider_profile_id: providerExecution ? providerProfileId : undefined,
        model_id: providerExecution ? providerModelId : undefined,
        tagger_profile_id: taggerExecution ? taggerProfileId : undefined,
        kind,
        scope: scope === "all" ? "all" : "selected",
        asset_ids: scopedAssetIds,
        translation_prompt_preset_id:
          kind === "translation" && providerExecution ? translationPromptPresetId : undefined,
        target_language: targetLanguage,
        translation_source_kind: translationSourceKind,
        translation_policy: translationPolicy,
      });
      onCreated(job);
    } catch (reason) {
      setError(actionError(reason, "无法创建任务。"));
    }
  }, [
    actions.create,
    checkedAssetIds,
    executionBackend,
    folderPaths,
    kind,
    onCreated,
    providerModelId,
    providerProfileId,
    refetchFolderAssetIds,
    scope,
    taggerProfileId,
    targetLanguage,
    translationPolicy,
    translationPromptPresetId,
    translationSourceKind,
    workspace,
  ]);

  return {
    systemPresets,
    translationPromptPresets,
    providerProfiles,
    taggerLibrary,
    tagDictionaryLibrary,
    kind,
    setKind,
    annotationBackend,
    setAnnotationBackend,
    translationBackend,
    setTranslationBackend,
    providerProfileId,
    setProviderProfileId,
    providerModelId,
    setProviderModelId,
    taggerProfileId,
    setTaggerProfileId,
    translationPromptPresetId,
    setTranslationPromptPresetId,
    scope,
    setScope,
    folderPaths,
    toggleFolderPath,
    clearFolderPaths,
    folderOptions,
    folderCount,
    folderLoading: folderLibrary.isPending || folderAssetIds.isFetching,
    folderError: folderLibrary.error ?? folderAssetIds.error,
    candidateActive: Boolean(candidateSummary.data?.active),
    effectiveAssetCount: candidateSummary.data?.effective_count ?? workspace?.asset_count ?? 0,
    targetLanguage,
    setTargetLanguage,
    translationSourceKind,
    setTranslationSourceKind,
    translationPolicy,
    setTranslationPolicy,
    executionBackend,
    selectedProvider,
    readyTaggerProfiles,
    selectedTaggerProfile,
    configuredSystemPreset,
    promptConfigurationIssue,
    configuredTranslationPrompt,
    translationPromptIssue,
    dictionaryReady,
    ready,
    error,
    createPending: actions.create.isPending,
    createJob,
  };
}
