import { useCallback, useMemo, useState } from "react";

import {
  useProviderProfileMutations,
  useProviderProfiles,
  useSystemPresetMutations,
  useSystemPresets,
  useTranslationPromptPresetMutations,
  useTranslationPromptPresets,
} from "../../../../features/presets/hooks";
import {
  useTagDictionaryActions,
  useTagDictionaryLibrary,
  useTagDictionarySearch,
} from "../../../../features/tagDictionaries/hooks";
import { useTaggerActions, useTaggerLibrary } from "../../../../features/taggers/hooks";
import type { TagDictionaryLibrary, TaggerLibrary } from "../../../../shared/api/types";
import { openExternalUrl } from "../../../../shared/desktop/openExternalUrl";
import { openLocalFolder } from "../../../../shared/desktop/openLocalFolder";
import {
  pickTagDictionaryFile,
  pickTagDictionaryFolder,
  pickTaggerLibraryFolder,
  pickTaggerModelFolder,
} from "../../../../shared/desktop/pickFolder";
import { formatBytes } from "../../../../shared/format/bytes";
import { useUnsavedChangesStore } from "../../../../shared/store/unsavedChangesStore";
import type {
  CapabilityDistrictId,
  CapabilityObjectEditor,
  CapabilityObjectRecord,
  CapabilitySpaceContent,
} from "../spacePageModel";
import {
  CAPABILITY_PROVIDER_PROTOCOLS,
  createProviderDraft,
  dictionarySearchItem,
  providerDraftToInput,
  providerProfileToDraft,
  taggerDraftToInput,
  taggerProfileToDraft,
} from "./capabilityEditorModel";
import {
  createCapabilityDistricts,
  findCapabilityObject,
  type CapabilityRouteSelection,
} from "./capabilitySpaceModel";

interface UseCapabilitySpaceControllerOptions {
  selection: CapabilityRouteSelection;
  onSelectDistrict(districtId: CapabilityDistrictId): void;
  onSelectObject(object: CapabilityObjectRecord): void;
  onProviderCreated(providerId: string): void;
  onReturnOverview(): void;
}

const NEW_PROVIDER_OBJECT: CapabilityObjectRecord = {
  id: "provider:new",
  routeId: "new",
  districtId: "providers",
  branchId: "connections",
  kind: "provider",
  code: "CON-NEW",
  name: "新增 API 供应商",
  englishName: "NEW PROVIDER CONNECTION",
  summary: "登记协议端点、认证凭据、模型清单与每个模型的独立生成参数。",
  status: "attention",
  statusLabel: "等待登记",
  readings: [
    { label: "协议", value: "SELECT" },
    { label: "模型", value: "ADD" },
    { label: "认证", value: "PENDING", tone: "attention" },
  ],
  items: [
    { id: "connection", label: "连接端点与并发", value: "CONNECTION" },
    { id: "models", label: "模型清单与默认模型", value: "MODELS" },
    { id: "parameters", label: "逐模型生成参数", value: "PARAMETERS" },
  ],
  body: null,
  updatedAt: null,
};

function isTaggerLibrary(value: unknown): value is TaggerLibrary {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Partial<TaggerLibrary>;
  return (
    Array.isArray(candidate.installations) &&
    Array.isArray(candidate.profiles) &&
    Boolean(candidate.runtime && typeof candidate.runtime === "object")
  );
}

function isDictionaryLibrary(value: unknown): value is TagDictionaryLibrary {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Partial<TagDictionaryLibrary>;
  return typeof candidate.entry_count === "number" && typeof candidate.override_count === "number";
}

function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : "能力索引读取失败";
}

export function useCapabilitySpaceController({
  selection,
  onSelectDistrict,
  onSelectObject,
  onProviderCreated,
  onReturnOverview,
}: UseCapabilitySpaceControllerOptions): CapabilitySpaceContent {
  const providers = useProviderProfiles();
  const taggers = useTaggerLibrary();
  const dictionaries = useTagDictionaryLibrary();
  const systemPrompts = useSystemPresets();
  const translationPrompts = useTranslationPromptPresets();
  const providerMutations = useProviderProfileMutations();
  const systemPromptMutations = useSystemPresetMutations();
  const translationPromptMutations = useTranslationPromptPresetMutations();
  const taggerActions = useTaggerActions();
  const dictionaryActions = useTagDictionaryActions();
  const [dictionaryQuery, setDictionaryQuery] = useState("");
  const dictionarySearch = useTagDictionarySearch(dictionaryQuery);
  const setDirtyScope = useUnsavedChangesStore((state) => state.setDirtyScope);
  const setEditorDirty = useCallback(
    (dirty: boolean) => setDirtyScope("capability-editor", dirty),
    [setDirtyScope],
  );
  const queries = [providers, taggers, dictionaries, systemPrompts, translationPrompts] as const;

  const districts = useMemo(
    () =>
      createCapabilityDistricts({
        providers: Array.isArray(providers.data) ? providers.data : [],
        taggers: isTaggerLibrary(taggers.data) ? taggers.data : null,
        dictionaries: isDictionaryLibrary(dictionaries.data) ? dictionaries.data : null,
        systemPrompts: Array.isArray(systemPrompts.data) ? systemPrompts.data : [],
        translationPrompts: Array.isArray(translationPrompts.data) ? translationPrompts.data : [],
      }),
    [dictionaries.data, providers.data, systemPrompts.data, taggers.data, translationPrompts.data],
  );
  const selectedObject = useMemo(
    () => findCapabilityObject(districts, selection),
    [districts, selection],
  );
  const creatingProvider =
    selection.districtId === "providers" &&
    selection.kind === "provider" &&
    selection.routeId === "new";
  const activeObject = creatingProvider ? NEW_PROVIDER_OBJECT : selectedObject;
  const pendingCount = queries.filter((query) => query.isPending).length;
  const errorQueries = queries.filter((query) => query.isError);
  const loadedCount = queries.length - pendingCount - errorQueries.length;
  const status: CapabilitySpaceContent["status"] =
    pendingCount === queries.length
      ? "loading"
      : errorQueries.length === queries.length
        ? "error"
        : errorQueries.length > 0
          ? "partial-error"
          : pendingCount > 0 && loadedCount === 0
            ? "loading"
            : "ready";
  const message = errorQueries.length
    ? [...new Set(errorQueries.map((query) => errorMessage(query.error)))].join(" / ")
    : null;
  const provider =
    !creatingProvider && activeObject?.kind === "provider"
      ? providers.data?.find((candidate) => candidate.id === activeObject.routeId)
      : null;
  const systemPrompt =
    activeObject?.kind === "system-prompt"
      ? systemPrompts.data?.find((candidate) => candidate.id === activeObject.routeId)
      : null;
  const translationPrompt =
    activeObject?.kind === "translation-prompt"
      ? translationPrompts.data?.find((candidate) => candidate.id === activeObject.routeId)
      : null;
  const taggerLibrary = isTaggerLibrary(taggers.data) ? taggers.data : null;
  const dictionaryLibrary = isDictionaryLibrary(dictionaries.data) ? dictionaries.data : null;
  const taggerInstallation =
    activeObject?.kind === "tagger-installation"
      ? taggerLibrary?.installations.find((candidate) => candidate.id === activeObject.routeId)
      : null;
  const taggerProfile =
    activeObject?.kind === "tagger-profile"
      ? taggerLibrary?.profiles.find((candidate) => candidate.id === activeObject.routeId)
      : null;
  const dictionaryInstallation =
    activeObject?.kind === "dictionary"
      ? dictionaryLibrary?.installations.find((candidate) => candidate.id === activeObject.routeId)
      : null;

  let activeEditor: CapabilityObjectEditor | null = null;
  if (creatingProvider) {
    activeEditor = {
      kind: "provider",
      mode: "create",
      form: createProviderDraft(),
      protocols: CAPABILITY_PROVIDER_PROTOCOLS,
      hasApiKey: false,
      pending: providerMutations.create.isPending,
      save: async (draft) => {
        const created = await providerMutations.create.mutateAsync(
          providerDraftToInput(draft, true),
        );
        onProviderCreated(created.id);
      },
    };
  } else if (provider) {
    activeEditor = {
      kind: "provider",
      mode: "edit",
      form: providerProfileToDraft(provider),
      protocols: CAPABILITY_PROVIDER_PROTOCOLS,
      hasApiKey: provider.has_api_key,
      pending:
        providerMutations.update.isPending ||
        providerMutations.remove.isPending ||
        providerMutations.create.isPending,
      save: async (draft) => {
        await providerMutations.update.mutateAsync({
          id: provider.id,
          input: providerDraftToInput(draft, draft.providerType !== provider.provider_type),
        });
      },
      clearApiKey: async () => {
        await providerMutations.update.mutateAsync({ id: provider.id, input: { api_key: "" } });
      },
      remove: async () => {
        await providerMutations.remove.mutateAsync(provider.id);
        onSelectDistrict("providers");
      },
    };
  } else if (systemPrompt) {
    activeEditor = {
      kind: "prompt",
      promptKind: "system",
      form: { name: systemPrompt.name, prompt: systemPrompt.system_prompt },
      pending: systemPromptMutations.update.isPending || systemPromptMutations.remove.isPending,
      save: async (draft) => {
        await systemPromptMutations.update.mutateAsync({
          id: systemPrompt.id,
          input: { name: draft.name.trim(), system_prompt: draft.prompt },
        });
      },
      remove: async () => {
        await systemPromptMutations.remove.mutateAsync(systemPrompt.id);
        onSelectDistrict("prompts");
      },
    };
  } else if (translationPrompt) {
    activeEditor = {
      kind: "prompt",
      promptKind: "translation",
      form: { name: translationPrompt.name, prompt: translationPrompt.system_prompt },
      pending:
        translationPromptMutations.update.isPending || translationPromptMutations.remove.isPending,
      save: async (draft) => {
        await translationPromptMutations.update.mutateAsync({
          id: translationPrompt.id,
          input: { name: draft.name.trim(), system_prompt: draft.prompt },
        });
      },
      remove: async () => {
        await translationPromptMutations.remove.mutateAsync(translationPrompt.id);
        onSelectDistrict("prompts");
      },
    };
  } else if (activeObject?.kind === "tagger-runtime" && taggerLibrary) {
    activeEditor = {
      kind: "tagger-runtime",
      modelRoot: taggerLibrary.model_root,
      devices: taggerLibrary.runtime.devices ?? [],
      providers: taggerLibrary.runtime.providers ?? [],
      scanIssues: taggerLibrary.scan_issues ?? [],
      pending:
        taggerActions.rescan.isPending ||
        taggerActions.setRoot.isPending ||
        taggerActions.importLocal.isPending,
      rescan: async () => {
        await taggerActions.rescan.mutateAsync();
      },
      chooseRoot: async () => {
        const path = await pickTaggerLibraryFolder();
        if (path) await taggerActions.setRoot.mutateAsync(path);
      },
      importModel: async () => {
        const path = await pickTaggerModelFolder();
        if (path) await taggerActions.importLocal.mutateAsync({ path });
      },
      openRoot: async () => openLocalFolder(taggerLibrary.model_root),
    };
  } else if (taggerInstallation && taggerLibrary) {
    activeEditor = {
      kind: "tagger-installation",
      path: taggerInstallation.path,
      files: (taggerInstallation.files ?? []).map((file) => ({
        path: file.relative_path,
        size: formatBytes(file.size),
      })),
      issues: [...(taggerInstallation.issues ?? []), ...(taggerInstallation.warnings ?? [])],
      linkedProfileCount: taggerLibrary.profiles.filter(
        (profile) => profile.installation_id === taggerInstallation.id,
      ).length,
      ready: taggerInstallation.status === "ready",
      pending:
        taggerActions.validate.isPending ||
        taggerActions.removeInstallation.isPending ||
        taggerActions.createProfile.isPending,
      validate: async () => {
        await taggerActions.validate.mutateAsync(taggerInstallation.id);
      },
      openFolder: async () => openLocalFolder(taggerInstallation.path),
      createProfile: async () => {
        const count = taggerLibrary.profiles.filter(
          (profile) => profile.installation_id === taggerInstallation.id,
        ).length;
        await taggerActions.createProfile.mutateAsync({
          name: `${taggerInstallation.name} 配置 ${count + 1}`,
          installation_id: taggerInstallation.id,
          selection: taggerInstallation.profile_capabilities.default_selection,
          categories: taggerInstallation.profile_capabilities.default_categories,
          device: "auto",
          batch_size: null,
        });
      },
      remove: async () => {
        await taggerActions.removeInstallation.mutateAsync(taggerInstallation.id);
        onSelectDistrict("taggers");
      },
    };
  } else if (taggerProfile && taggerLibrary) {
    activeEditor = {
      kind: "tagger-profile",
      form: taggerProfileToDraft(taggerProfile),
      installations: taggerLibrary.installations
        .filter((installation) => installation.status === "ready")
        .map((installation) => ({
          id: installation.id,
          name: installation.name,
          modelVersion: installation.model_version,
          categories: installation.categories ?? {},
          supportedSelectionModes: installation.profile_capabilities.supported_selection_modes,
        })),
      availableDevices: taggerLibrary.runtime.devices ?? [],
      pending: taggerActions.updateProfile.isPending || taggerActions.removeProfile.isPending,
      save: async (draft) => {
        await taggerActions.updateProfile.mutateAsync({
          id: taggerProfile.id,
          input: taggerDraftToInput(draft),
        });
      },
      remove: async () => {
        await taggerActions.removeProfile.mutateAsync(taggerProfile.id);
        onSelectDistrict("taggers");
      },
    };
  } else if (dictionaryInstallation && dictionaryLibrary) {
    const ordered = [...dictionaryLibrary.installations].sort(
      (left, right) => left.priority - right.priority,
    );
    activeEditor = {
      kind: "dictionary",
      form: { name: dictionaryInstallation.name, enabled: dictionaryInstallation.enabled },
      path: dictionaryInstallation.path,
      licenseUrl: dictionaryInstallation.license_url,
      priority: dictionaryInstallation.priority,
      installationCount: ordered.length,
      ready: dictionaryInstallation.status === "ready",
      pending:
        dictionaryActions.updateInstallation.isPending ||
        dictionaryActions.reorder.isPending ||
        dictionaryActions.removeInstallation.isPending,
      save: async (draft) => {
        await dictionaryActions.updateInstallation.mutateAsync({
          id: dictionaryInstallation.id,
          input: { name: draft.name.trim(), enabled: draft.enabled },
        });
      },
      move: async (offset) => {
        const ids = ordered.map((installation) => installation.id);
        const index = ids.indexOf(dictionaryInstallation.id);
        const target = index + offset;
        if (index < 0 || target < 0 || target >= ids.length) return;
        [ids[index], ids[target]] = [ids[target], ids[index]];
        await dictionaryActions.reorder.mutateAsync(ids);
      },
      openFolder: async () => openLocalFolder(dictionaryInstallation.path),
      openLicense: async () => openExternalUrl(dictionaryInstallation.license_url),
      remove: async () => {
        await dictionaryActions.removeInstallation.mutateAsync(dictionaryInstallation.id);
        onSelectDistrict("dictionaries");
      },
    };
  } else if (activeObject?.kind === "dictionary-overrides") {
    activeEditor = {
      kind: "dictionary-overrides",
      dictionaryRoot: dictionaryLibrary?.dictionary_root ?? "",
      query: dictionaryQuery,
      results: (dictionarySearch.data?.items ?? []).map(dictionarySearchItem),
      searching: dictionarySearch.isFetching,
      searchError: dictionarySearch.isError ? errorMessage(dictionarySearch.error) : null,
      pending:
        dictionaryActions.importLocal.isPending ||
        dictionaryActions.upsertOverride.isPending ||
        dictionaryActions.removeOverride.isPending,
      importFile: async () => {
        const path = await pickTagDictionaryFile();
        if (path) await dictionaryActions.importLocal.mutateAsync({ path });
      },
      importFolder: async () => {
        const path = await pickTagDictionaryFolder();
        if (path) await dictionaryActions.importLocal.mutateAsync({ path });
      },
      openRoot: async () => {
        if (dictionaryLibrary?.dictionary_root) {
          await openLocalFolder(dictionaryLibrary.dictionary_root);
        }
      },
      search: setDictionaryQuery,
      save: async (draft) => {
        await dictionaryActions.upsertOverride.mutateAsync({
          tag: draft.tag.trim(),
          translation: draft.translation.trim(),
          language: "zh-CN",
          category: draft.category?.trim() || null,
        });
        setDictionaryQuery(draft.tag.trim());
      },
      remove: async (tag) => {
        await dictionaryActions.removeOverride.mutateAsync({ tag, language: "zh-CN" });
      },
    };
  }

  return {
    kind: "capability",
    status,
    districts,
    activeDistrictId: selection.districtId,
    activeObjectId: activeObject?.id ?? null,
    activeObject,
    activeEditor,
    message,
    selectDistrict: onSelectDistrict,
    selectObject: onSelectObject,
    returnOverview: onReturnOverview,
    closeObject: () => {
      if (selection.districtId) onSelectDistrict(selection.districtId);
      else onReturnOverview();
    },
    setEditorDirty,
    refresh: () => {
      void Promise.all(queries.map((query) => query.refetch()));
    },
  };
}
