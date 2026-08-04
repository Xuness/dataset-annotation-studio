import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useUnsavedScope } from "../../../../application/useUnsavedScope";
import { useAssetMetadata, usePromptPreview } from "../../../../features/assets/hooks";
import { useSystemPresets } from "../../../../features/presets/hooks";
import { useUpdateWorkspace } from "../../../../features/workspaces/hooks";
import type { WorkspaceSummary } from "../../../../shared/api/types";
import type {
  AnnotationProjectContextContent,
  AnnotationRequestPreviewContent,
} from "../spacePageModel";

interface UseAnnotationProjectContextControllerOptions {
  projectId: string;
  workspace: WorkspaceSummary | null;
  assetId: string | null;
  enabled: boolean;
  previewEnabled: boolean;
}

export interface AnnotationProjectContextControllerResult {
  content: AnnotationProjectContextContent;
  preview: AnnotationRequestPreviewContent;
  discardImmediately(): void;
}

interface SavedProjectContext {
  systemPresetId: string;
  userPrompt: string;
  useTagsAsContext: boolean;
  jsonFields: string[];
}

function savedContext(workspace: WorkspaceSummary | null): SavedProjectContext {
  return {
    systemPresetId: workspace?.settings.system_preset_id ?? "",
    userPrompt: workspace?.settings.user_prompt ?? "",
    useTagsAsContext: workspace?.settings.use_tags_as_context ?? false,
    jsonFields: [...(workspace?.settings.json_fields ?? [])],
  };
}

function sameFields(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  const rightSet = new Set(right);
  return left.every((field) => rightSet.has(field));
}

function describeError(reason: unknown, fallback: string): string {
  return reason instanceof Error ? reason.message : fallback;
}

export function useAnnotationProjectContextController({
  projectId,
  workspace,
  assetId,
  enabled,
  previewEnabled,
}: UseAnnotationProjectContextControllerOptions): AnnotationProjectContextControllerResult {
  const initial = savedContext(workspace);
  const savedRef = useRef(initial);
  const draftRef = useRef(initial);
  const [systemPresetId, setSystemPresetId] = useState(initial.systemPresetId);
  const [userPrompt, setUserPrompt] = useState(initial.userPrompt);
  const [useTagsAsContext, setUseTagsAsContext] = useState(initial.useTagsAsContext);
  const [jsonFields, setJsonFields] = useState(initial.jsonFields);
  const [actionError, setActionError] = useState<string | null>(null);
  const presets = useSystemPresets(enabled || previewEnabled);
  const metadata = useAssetMetadata(projectId, assetId, enabled);
  const preview = usePromptPreview(projectId, assetId, previewEnabled);
  const update = useUpdateWorkspace(projectId);

  const draft = useMemo<SavedProjectContext>(
    () => ({ systemPresetId, userPrompt, useTagsAsContext, jsonFields }),
    [jsonFields, systemPresetId, useTagsAsContext, userPrompt],
  );
  draftRef.current = draft;
  const saved = savedContext(workspace);
  const savedKey = JSON.stringify(saved);
  const dirty =
    draft.systemPresetId !== saved.systemPresetId ||
    draft.userPrompt !== saved.userPrompt ||
    draft.useTagsAsContext !== saved.useTagsAsContext ||
    !sameFields(draft.jsonFields, saved.jsonFields);

  useEffect(() => {
    const previous = savedRef.current;
    const current = draftRef.current;
    const wasClean =
      current.systemPresetId === previous.systemPresetId &&
      current.userPrompt === previous.userPrompt &&
      current.useTagsAsContext === previous.useTagsAsContext &&
      sameFields(current.jsonFields, previous.jsonFields);
    savedRef.current = saved;
    if (!wasClean) return;
    setSystemPresetId(saved.systemPresetId);
    setUserPrompt(saved.userPrompt);
    setUseTagsAsContext(saved.useTagsAsContext);
    setJsonFields(saved.jsonFields);
    setActionError(null);
    // savedKey intentionally represents the complete server-side context snapshot.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, savedKey]);

  useUnsavedScope(`v2-annotation-context:${projectId}`, dirty);

  const discardImmediately = useCallback(() => {
    const next = savedRef.current;
    setSystemPresetId(next.systemPresetId);
    setUserPrompt(next.userPrompt);
    setUseTagsAsContext(next.useTagsAsContext);
    setJsonFields([...next.jsonFields]);
    setActionError(null);
  }, []);

  const toggleMetadataField = useCallback((field: string) => {
    setJsonFields((current) =>
      current.includes(field) ? current.filter((item) => item !== field) : [...current, field],
    );
    setActionError(null);
  }, []);

  const selectedPreset = presets.data?.find((preset) => preset.id === systemPresetId) ?? null;
  const presetValid = Boolean(selectedPreset);

  const save = useCallback(async () => {
    if (!workspace || update.isPending) return;
    const current = draftRef.current;
    const currentPresetExists = Boolean(
      presets.data?.some((preset) => preset.id === current.systemPresetId),
    );
    if (!current.systemPresetId || !currentPresetExists) {
      setActionError("请先选择一个有效的 System Prompt 预设。");
      return;
    }
    setActionError(null);
    try {
      const nextWorkspace = await update.mutateAsync({
        system_preset_id: current.systemPresetId,
        user_prompt: current.userPrompt,
        use_tags_as_context: current.useTagsAsContext,
        json_fields: current.jsonFields,
      });
      const next = savedContext(nextWorkspace);
      savedRef.current = next;
      setSystemPresetId(next.systemPresetId);
      setUserPrompt(next.userPrompt);
      setUseTagsAsContext(next.useTagsAsContext);
      setJsonFields(next.jsonFields);
    } catch (reason) {
      setActionError(describeError(reason, "保存项目上下文失败。"));
    }
  }, [presets.data, update, workspace]);

  const metadataStatus: AnnotationProjectContextContent["metadataStatus"] = !assetId
    ? "no-object"
    : metadata.isPending
      ? "loading"
      : metadata.isError || metadata.data?.error
        ? "error"
        : !metadata.data?.exists
          ? "missing"
          : "ready";
  const metadataRaw =
    metadata.data?.exists && metadata.data.value !== null
      ? JSON.stringify(metadata.data.value, null, 2)
      : null;
  const metadataFields = (metadata.data?.fields ?? []).map((field) => ({
    id: field,
    selected: jsonFields.includes(field),
  }));
  const contextMessage = presets.isError
    ? describeError(presets.error, "无法读取 System Prompt 预设。")
    : metadata.isError
      ? describeError(metadata.error, "无法读取当前素材元数据。")
      : (metadata.data?.error ?? null);

  const previewContent: AnnotationRequestPreviewContent = {
    status: !assetId
      ? "no-object"
      : preview.isPending
        ? "loading"
        : preview.isError
          ? "error"
          : preview.data
            ? "ready"
            : "loading",
    message: preview.isError ? describeError(preview.error, "无法拼装下一次最终请求。") : null,
    basedOnSavedContext: dirty,
    configurationIssue: preview.data?.configuration_issue ?? null,
    systemPresetName: preview.data?.system_preset_name ?? null,
    systemPrompt: preview.data?.system_prompt ?? "",
    userPrompt: preview.data?.user_prompt ?? "",
    finalUserPrompt: preview.data?.final_user_prompt ?? "",
    metadataLines: preview.data?.metadata_lines ?? [],
    tagContextStatus: preview.data?.tag_context_status ?? "disabled",
    tagCount: preview.data?.tag_count ?? 0,
    tagLine: preview.data?.tag_line ?? null,
  };

  return {
    content: {
      status: presets.isPending ? "loading" : presets.isError ? "error" : "ready",
      message: contextMessage,
      systemPresetId,
      systemPresets:
        presets.data?.map((preset) => ({
          id: preset.id,
          name: preset.name,
          systemPrompt: preset.system_prompt,
        })) ?? [],
      selectedSystemPrompt: selectedPreset?.system_prompt ?? "",
      userPrompt,
      useTagsAsContext,
      metadataStatus,
      metadataPath: metadata.data?.path ?? null,
      metadataFields,
      metadataRaw,
      dirty,
      writePending: update.isPending,
      canSave: Boolean(workspace && dirty && presetValid && !update.isPending),
      actionError,
      setSystemPreset: (id) => {
        setSystemPresetId(id);
        setActionError(null);
      },
      setUserPrompt: (value) => {
        setUserPrompt(value);
        setActionError(null);
      },
      setUseTagsAsContext: (value) => {
        setUseTagsAsContext(value);
        setActionError(null);
      },
      toggleMetadataField,
      save,
      discard: discardImmediately,
    },
    preview: previewContent,
    discardImmediately,
  };
}
