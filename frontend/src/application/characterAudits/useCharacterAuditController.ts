import { useEffect, useRef, useState } from "react";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";

import type { ConfirmInteraction } from "../interaction";
import { useWorkspace } from "../../features/workspaces/hooks";
import { invalidateWorkspaceMutation } from "../../shared/query/workspaceQueries";
import { useUnsavedScope } from "../useUnsavedScope";
import { imageUrl, listAssets } from "../../features/assets/api";
import * as api from "../../features/characterAudits/api";
import { listProviderProfiles } from "../../features/presets/api";
import { getTaggerLibrary } from "../../features/taggers/api";
import { useWorkspaceSelectionStore } from "../../shared/store/workspaceSelectionStore";
import type {
  CharacterAudit,
  CharacterAuditDecision,
  CharacterAuditMembership,
  CharacterAuditPreview,
} from "../../shared/api/contracts/characterAudits";
import type { CharacterAuditContent } from "./characterAuditModel";
import {
  ACTIVE_CHARACTER_AUDIT_STATUSES as ACTIVE,
  emptyCharacterProfile,
  initialCharacterForm,
} from "./characterAuditModel";

interface Options {
  projectId: string | null;
  confirm: ConfirmInteraction;
  operationId: string | null;
  onSelectOperation(id: string | null): void;
  onReturnToAnnotation(): void;
  onOpenPrerequisite(id: string): void;
}
interface ReviewDraft {
  operationId: string;
  profileIndex: number;
  version: number;
  decisions: readonly CharacterAuditDecision[];
}

export function useCharacterAuditController({
  projectId,
  confirm,
  operationId,
  onSelectOperation,
  onReturnToAnnotation,
  onOpenPrerequisite,
}: Options): CharacterAuditContent {
  const client = useQueryClient();
  const workspace = useWorkspace(projectId ?? "");
  const setActiveProject = useWorkspaceSelectionStore((state) => state.setActiveProject);
  useEffect(() => {
    if (projectId) setActiveProject(projectId);
  }, [projectId, setActiveProject]);
  const [form, setForm] = useState(initialCharacterForm);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [profileIndex, setProfileIndex] = useState(0);
  const [draft, setDraft] = useState<ReviewDraft | null>(null);
  const [membership, setMembership] = useState<CharacterAuditMembership | null>(null);
  const [preview, setPreview] = useState<CharacterAuditPreview | null>(null);
  const [vocabularyDirectory, setVocabularyDirectory] = useState("");
  const [vocabularyVersion, setVocabularyVersion] = useState(
    "682a842fdab63baacda5f0b3f3727f379f3b66ed",
  );
  const [licenseAcknowledged, setLicenseAcknowledged] = useState(false);
  const [taggerProfileId, setTaggerProfileId] = useState("");
  const [overwriteExisting, setOverwriteExisting] = useState(false);
  const [referenceSearch, setReferenceSearch] = useState("");
  const checkedAssetIds = useWorkspaceSelectionStore((state) => state.checkedAssetIds);
  const operations = useQuery({
    queryKey: ["character-audits", projectId],
    queryFn: () => api.listCharacterAudits(requireProject()),
    enabled: Boolean(projectId),
    refetchInterval: 2000,
  });
  const current = useQuery({
    queryKey: ["character-audit", projectId, operationId],
    queryFn: () => api.getCharacterAudit(requireProject(), requireOperationId()),
    enabled: Boolean(projectId && operationId),
    refetchInterval: (query) =>
      query.state.data && ACTIVE.has(query.state.data.status) ? 1000 : false,
  });
  const providers = useQuery({
    queryKey: ["character-audit-providers"],
    queryFn: listProviderProfiles,
  });
  const taggers = useQuery({ queryKey: ["character-audit-taggers"], queryFn: getTaggerLibrary });
  const vocabulary = useQuery({
    queryKey: ["character-audit-vocabularies"],
    queryFn: api.listCharacterVocabularies,
  });
  const assets = useInfiniteQuery({
    queryKey: ["character-audit-assets", projectId, referenceSearch],
    queryFn: ({ pageParam }) =>
      listAssets(requireProject(), { offset: pageParam, limit: 120, search: referenceSearch }),
    initialPageParam: 0,
    getNextPageParam: (page, pages) => {
      const count = pages.reduce((sum, entry) => sum + entry.items.length, 0);
      return count < page.total ? count : undefined;
    },
    enabled: Boolean(projectId),
  });
  const operation = current.data ?? null;
  const activeDraft =
    draft?.operationId === operationId && draft.profileIndex === profileIndex ? draft : null;
  const dirty = activeDraft !== null;
  const review = operation?.reviews[profileIndex];
  const decisions = activeDraft?.decisions ?? review?.decisions ?? [];
  useUnsavedScope(`character-audit:${projectId}`, dirty);

  function requireProject(): string {
    if (!projectId) throw new Error("请先选择项目。");
    return projectId;
  }
  function requireOperationId(): string {
    if (!operationId) throw new Error("请先创建或选择角色审查任务。");
    return operationId;
  }
  function requireOperation(): CharacterAudit {
    if (!operation) throw new Error("审查任务尚未加载。");
    return operation;
  }
  async function leaveDraft(): Promise<boolean> {
    return (
      !dirty ||
      confirm({
        message: "角色审阅有未保存的决定，是否丢弃后离开？",
        title: "尚未保存",
        tone: "danger",
        confirmLabel: "丢弃修改",
      })
    );
  }
  async function execute(action: () => Promise<void>): Promise<void> {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setMessage(null);
    try {
      await action();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  async function accept(next: CharacterAudit): Promise<void> {
    client.setQueryData(["character-audit", projectId, next.id], next);
    setPreview(null);
    await client.invalidateQueries({ queryKey: ["character-audits", projectId] });
  }
  function request() {
    return { ...form, asset_ids: form.scope === "selected" ? [...checkedAssetIds] : [] };
  }
  const loadError = [
    workspace.error,
    operations.error,
    current.error,
    providers.error,
    taggers.error,
    vocabulary.error,
    assets.error,
  ].find(Boolean);
  const references = (assets.data?.pages ?? []).flatMap((page) =>
    page.items.map((asset) => ({
      id: asset.id,
      name: asset.relative_path,
      imageUrl: imageUrl(requireProject(), asset.id, asset.content_version),
    })),
  );
  const reference = operation?.references[profileIndex];

  return {
    kind: "character-audit",
    workspace: workspace.data ?? null,
    projectId,
    status: loadError
      ? "error"
      : projectId &&
          (workspace.isPending ||
            operations.isPending ||
            providers.isPending ||
            vocabulary.isPending ||
            (operationId && current.isPending))
        ? "loading"
        : "ready",
    busy,
    message: message ?? (loadError instanceof Error ? loadError.message : null),
    issues: vocabulary.data?.issues ?? [],
    operations: operations.data ?? [],
    operation,
    form,
    checkedCount: checkedAssetIds.length,
    providers: (providers.data ?? []).map((item) => ({
      id: item.id,
      name: item.name,
      models: item.models.map((model) => model.model_id),
    })),
    taggers: (taggers.data?.profiles ?? []).map((item) => ({ id: item.id, name: item.name })),
    vocabularies: vocabulary.data?.installations ?? [],
    references,
    referenceSearch,
    hasMoreReferences: Boolean(assets.hasNextPage),
    membership,
    preview,
    profileIndex,
    decisions,
    dirty,
    sourceImages:
      operation && projectId
        ? operation.source_assets.map((asset) => ({
            id: asset.asset_id,
            name: asset.relative_path,
            imageUrl: imageUrl(projectId, asset.asset_id, asset.image_hash),
          }))
        : [],
    referenceUrl:
      reference && projectId ? imageUrl(projectId, reference.asset_id, reference.image_hash) : null,
    vocabularyDirectory,
    vocabularyVersion,
    licenseAcknowledged,
    taggerProfileId,
    overwriteExisting,
    setForm: (next) => {
      setForm(next);
      setMembership(null);
    },
    setVocabularyDirectory,
    setVocabularyVersion,
    setLicenseAcknowledged,
    setTaggerProfileId,
    setOverwriteExisting,
    searchReferences: setReferenceSearch,
    loadMoreReferences: () => {
      if (assets.hasNextPage && !assets.isFetchingNextPage) void assets.fetchNextPage();
    },
    updateProfile: (index, profile) => {
      setForm((value) => ({
        ...value,
        profiles: value.profiles.map((item, i) => (i === index ? profile : item)),
      }));
      setMembership(null);
    },
    addProfile: () => {
      setForm((value) =>
        value.profiles.length < 4
          ? { ...value, profiles: [...value.profiles, emptyCharacterProfile()] }
          : value,
      );
      setMembership(null);
    },
    removeProfile: (index) => {
      setForm((value) =>
        value.profiles.length > 1
          ? { ...value, profiles: value.profiles.filter((_, i) => i !== index) }
          : value,
      );
      setMembership(null);
    },
    importVocabulary: () =>
      execute(async () => {
        if (!licenseAcknowledged) throw new Error("请先阅读并确认词表来源及授权说明。");
        const installed = await api.importCharacterVocabulary(
          vocabularyDirectory,
          vocabularyVersion,
        );
        await vocabulary.refetch();
        setForm((value) => ({ ...value, vocabulary_id: installed.id }));
        setMessage("语义词表已安装并通过完整性校验。");
      }),
    previewMembership: () =>
      execute(async () => {
        setMembership(await api.previewCharacterMembership(requireProject(), request()));
      }),
    create: () =>
      execute(async () => {
        const next = await api.createCharacterAudit(requireProject(), request());
        await accept(next);
        setProfileIndex(0);
        setDraft(null);
        onSelectOperation(next.id);
      }),
    selectOperation: async (id) => {
      if (!(await leaveDraft())) return;
      setDraft(null);
      setProfileIndex(0);
      setPreview(null);
      setMessage(null);
      onSelectOperation(id);
    },
    start: () =>
      execute(async () => {
        await accept(
          await api.startCharacterAudit(
            requireProject(),
            requireOperationId(),
            requireOperation().version,
          ),
        );
      }),
    stop: () =>
      execute(async () => {
        await accept(await api.stopCharacterAudit(requireProject(), requireOperationId()));
      }),
    prepareTags: () =>
      execute(async () => {
        if (!taggerProfileId) throw new Error("请选择本地打标配置。");
        if (
          overwriteExisting &&
          !(await confirm({
            message: "将覆盖范围内已有 Tags 并创建新修订，确认重新打标？",
            title: "重新打标",
            tone: "danger",
          }))
        )
          return;
        await accept(
          await api.prepareCharacterTags(
            requireProject(),
            requireOperationId(),
            requireOperation().version,
            taggerProfileId,
            overwriteExisting,
          ),
        );
      }),
    selectProfile: async (index) => {
      if (await leaveDraft()) {
        setDraft(null);
        setProfileIndex(index);
      }
    },
    updateDecision: (index, decision) => {
      const op = requireOperation();
      setDraft({
        operationId: op.id,
        profileIndex,
        version: activeDraft?.version ?? op.version,
        decisions: decisions.map((item, i) => (index === i ? decision : item)),
      });
      setPreview(null);
    },
    useSuggestions: () => {
      const op = requireOperation();
      setDraft({
        operationId: op.id,
        profileIndex,
        version: activeDraft?.version ?? op.version,
        decisions: op.reviews[profileIndex].suggested,
      });
      setPreview(null);
    },
    saveReview: () =>
      execute(async () => {
        await accept(
          await api.saveCharacterReview(
            requireProject(),
            requireOperationId(),
            profileIndex,
            activeDraft?.version ?? requireOperation().version,
            decisions,
          ),
        );
        setDraft(null);
        setMessage("角色决定已保存，整份 Tags 的人工复核状态未改变。");
      }),
    redoVisual: () =>
      execute(async () => {
        if (dirty) throw new Error("请先保存人工决定，视觉重审不会自动覆盖已保存决定。");
        if (
          !(await confirm({
            message:
              "仅重跑此角色的视觉阶段，可能产生模型费用；新建议不会覆盖已有人工决定，是否继续？",
            title: "视觉重审",
            confirmLabel: "开始重审",
          }))
        )
          return;
        await accept(
          await api.redoCharacterVisual(
            requireProject(),
            requireOperationId(),
            profileIndex,
            requireOperation().version,
          ),
        );
      }),
    generatePreview: () =>
      execute(async () => {
        if (dirty) throw new Error("请先保存角色决定再生成预览。");
        setPreview(await api.previewCharacterAudit(requireProject(), requireOperationId()));
      }),
    resolveConflict: (resolution) =>
      execute(async () => {
        const op = requireOperation();
        const resolutions = [
          ...op.resolutions.filter(
            (item) => !(item.asset_id === resolution.asset_id && item.tag === resolution.tag),
          ),
          resolution,
        ];
        await accept(
          await api.saveCharacterResolutions(requireProject(), op.id, op.version, resolutions),
        );
        setPreview(await api.previewCharacterAudit(requireProject(), op.id));
      }),
    apply: () =>
      execute(async () => {
        if (!preview || dirty) throw new Error("请先保存决定并生成应用预览。");
        if (preview.conflicts.some((item) => !item.resolution))
          throw new Error("请先裁决所有多人冲突。");
        if (
          !(await confirm({
            message: `确认给 ${preview.changed_count} 张图片创建 Tags 修订？不会写入 TXT，也不会将全部 Tags 标记为已复核。`,
            title: "应用角色审查",
            confirmLabel: "确认应用",
          }))
        )
          return;
        await accept(
          await api.applyCharacterAudit(
            requireProject(),
            requireOperationId(),
            preview.preview_token,
          ),
        );
        await invalidateWorkspaceMutation(client, requireProject(), "annotation-written");
        setMessage("角色审查修改已原子应用，未改写 TXT。");
      }),
    copyPrompt: () =>
      execute(async () => {
        const prompt = requireOperation().reviews[profileIndex]?.prompt;
        if (!prompt) throw new Error("此角色尚未生成提示词。");
        await navigator.clipboard.writeText(prompt);
        setMessage("角色提示词已复制。");
      }),
    openPrerequisite: async () => {
      if (operation?.prerequisite_job_id && (await leaveDraft()))
        onOpenPrerequisite(operation.prerequisite_job_id);
    },
    returnToAnnotation: async () => {
      if (await leaveDraft()) {
        setDraft(null);
        onReturnToAnnotation();
      }
    },
  };
}
