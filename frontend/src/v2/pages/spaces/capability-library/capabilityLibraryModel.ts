import type {
  ProviderProfile,
  SystemDiagnostics,
  SystemPreset,
  TagDictionaryLibrary,
  TaggerLibrary,
  TranslationPromptPreset,
} from "../../../../shared/api/types";
import { formatBytes } from "../../../../shared/format/bytes";

export const CAPABILITY_LIBRARY_CATEGORY_IDS = [
  "providers",
  "taggers",
  "dictionaries",
  "prompts",
  "system",
] as const;

export type CapabilityLibraryCategoryId = (typeof CAPABILITY_LIBRARY_CATEGORY_IDS)[number];

export type CapabilityLibraryLane = "primary" | "system";
export type CapabilityLibraryCategoryState = "loading" | "ready" | "attention" | "error";
export type CapabilityLibrarySourceState = "loading" | "ready" | "error";

export interface CapabilityLibraryCategoryDefinition {
  id: CapabilityLibraryCategoryId;
  index: string;
  code: string;
  label: string;
  englishLabel: string;
  description: string;
  lane: CapabilityLibraryLane;
}

export const CAPABILITY_LIBRARY_CATEGORY_DEFINITIONS = [
  {
    id: "providers",
    index: "01",
    code: "PVD",
    label: "模型连接",
    englishLabel: "Provider Gateway",
    description: "组织模型服务、协议档案与可调用模型配置。",
    lane: "primary",
  },
  {
    id: "taggers",
    index: "02",
    code: "TAG",
    label: "本地打标",
    englishLabel: "Local Taggers",
    description: "维护本地识别模型、运行时与生产配置。",
    lane: "primary",
  },
  {
    id: "dictionaries",
    index: "03",
    code: "DIC",
    label: "Tag 词典",
    englishLabel: "Tag Dictionaries",
    description: "编排词典优先级、翻译条目与本地覆盖。",
    lane: "primary",
  },
  {
    id: "prompts",
    index: "04",
    code: "PRM",
    label: "Prompt 协议",
    englishLabel: "Prompt Protocols",
    description: "集中保管系统提示词与结构保留翻译协议。",
    lane: "primary",
  },
  {
    id: "system",
    index: "S1",
    code: "SYS",
    label: "Studio 控制",
    englishLabel: "Studio Control",
    description: "收纳界面外观、更新公告与运行诊断。",
    lane: "system",
  },
] as const satisfies readonly CapabilityLibraryCategoryDefinition[];

export interface CapabilityLibraryMetric {
  id: string;
  label: string;
  value: string;
  unit?: string;
}

export interface CapabilityLibraryInventoryItem {
  id: string;
  label: string;
  detail: string;
  state: "ready" | "attention";
}

export interface CapabilityLibraryCategory extends CapabilityLibraryCategoryDefinition {
  state: CapabilityLibraryCategoryState;
  stateLabel: string;
  headlineValue: string;
  headlineLabel: string;
  summary: string;
  notice: string | null;
  metrics: readonly CapabilityLibraryMetric[];
  inventory: readonly CapabilityLibraryInventoryItem[];
}

export interface CapabilityLibrarySourceStates {
  providers: CapabilityLibrarySourceState;
  taggers: CapabilityLibrarySourceState;
  dictionaries: CapabilityLibrarySourceState;
  systemPrompts: CapabilityLibrarySourceState;
  translationPrompts: CapabilityLibrarySourceState;
  diagnostics: CapabilityLibrarySourceState;
}

export interface CapabilityLibraryOverviewInput {
  providers: readonly ProviderProfile[];
  taggers: TaggerLibrary | null;
  dictionaries: TagDictionaryLibrary | null;
  systemPrompts: readonly SystemPreset[];
  translationPrompts: readonly TranslationPromptPreset[];
  diagnostics: SystemDiagnostics | null;
  hasUnreadAnnouncement: boolean;
  sources: CapabilityLibrarySourceStates;
  errors?: readonly string[];
}

export interface CapabilityLibraryOverview {
  status: "loading" | "ready" | "partial-error" | "error";
  categories: readonly CapabilityLibraryCategory[];
  message: string | null;
}

export interface CapabilityLibraryContent extends CapabilityLibraryOverview {
  kind: "capability-library";
  refresh(): void;
}

const INTEGER_FORMATTER = new Intl.NumberFormat("en-US");

function integer(value: number): string {
  return INTEGER_FORMATTER.format(value);
}

function categoryDefinition(id: CapabilityLibraryCategoryId): CapabilityLibraryCategoryDefinition {
  const definition = CAPABILITY_LIBRARY_CATEGORY_DEFINITIONS.find((item) => item.id === id);
  if (!definition) throw new Error(`Unknown capability library category: ${id}`);
  return definition;
}

function stateLabel(state: CapabilityLibraryCategoryState): string {
  if (state === "loading") return "SYNCING";
  if (state === "error") return "OFFLINE";
  if (state === "attention") return "CHECK";
  return "ONLINE";
}

function singleSourceState(
  source: CapabilityLibrarySourceState,
  options: { empty: boolean; attention?: boolean },
): CapabilityLibraryCategoryState {
  if (source === "loading") return "loading";
  if (source === "error") return "error";
  return options.empty || options.attention ? "attention" : "ready";
}

function combinedSourceState(
  sources: readonly CapabilityLibrarySourceState[],
  options: { empty: boolean; attention?: boolean },
): CapabilityLibraryCategoryState {
  if (sources.every((source) => source === "error")) return "error";
  if (sources.some((source) => source === "loading")) return "loading";
  if (sources.some((source) => source === "error")) return "attention";
  return options.empty || options.attention ? "attention" : "ready";
}

function providersCategory(input: CapabilityLibraryOverviewInput): CapabilityLibraryCategory {
  const models = input.providers.reduce((count, profile) => count + profile.models.length, 0);
  const concurrency = input.providers.reduce((count, profile) => count + profile.concurrency, 0);
  const credentialed = input.providers.filter((profile) => profile.has_api_key).length;
  const state = singleSourceState(input.sources.providers, { empty: input.providers.length === 0 });
  return {
    ...categoryDefinition("providers"),
    state,
    stateLabel: stateLabel(state),
    headlineValue: integer(models),
    headlineLabel: "REGISTERED MODELS",
    summary:
      input.providers.length > 0
        ? `${integer(input.providers.length)} 个连接档案已登记 ${integer(models)} 个模型配置。`
        : "尚未建立模型连接档案。",
    notice: state === "error" ? "模型连接索引当前不可用。" : null,
    metrics: [
      { id: "profiles", label: "PROFILES", value: integer(input.providers.length) },
      { id: "models", label: "MODELS", value: integer(models) },
      { id: "keys", label: "KEYED", value: integer(credentialed) },
      { id: "concurrency", label: "PARALLEL", value: integer(concurrency) },
    ],
    inventory: input.providers.slice(0, 5).map((profile) => ({
      id: profile.id,
      label: profile.name,
      detail: `${profile.provider_type.toUpperCase()} // ${profile.default_model_id || "NO DEFAULT"}`,
      state: "ready",
    })),
  };
}

function taggersCategory(input: CapabilityLibraryOverviewInput): CapabilityLibraryCategory {
  const library = input.taggers;
  const installations = library?.installations ?? [];
  const profiles = library?.profiles ?? [];
  const readyInstallations = installations.filter((item) => item.status === "ready").length;
  const readyProfiles = profiles.filter((item) => item.ready).length;
  const issueCount =
    (library?.scan_issues?.length ?? 0) +
    installations.reduce(
      (count, item) => count + (item.issues?.length ?? 0) + (item.status === "ready" ? 0 : 1),
      0,
    ) +
    profiles.filter((item) => !item.ready || item.issue).length +
    (library?.runtime.error ? 1 : 0);
  const state = singleSourceState(input.sources.taggers, {
    empty: installations.length === 0,
    attention: issueCount > 0 || library?.runtime.available === false,
  });
  return {
    ...categoryDefinition("taggers"),
    state,
    stateLabel: stateLabel(state),
    headlineValue: integer(readyInstallations),
    headlineLabel: "READY INSTALLATIONS",
    summary:
      installations.length > 0
        ? `${integer(readyInstallations)} / ${integer(installations.length)} 个本地模型通过索引检查。`
        : "尚未发现本地 Tagger 安装。",
    notice:
      state === "error"
        ? "本地打标索引当前不可用。"
        : issueCount > 0
          ? `${integer(issueCount)} 项运行或索引提示需要检查。`
          : null,
    metrics: [
      { id: "installations", label: "INSTALLS", value: integer(installations.length) },
      { id: "profiles", label: "PROFILES", value: integer(profiles.length) },
      { id: "ready", label: "READY CFG", value: integer(readyProfiles) },
      { id: "disk", label: "VOLUME", value: formatBytes(library?.disk_size ?? 0) },
    ],
    inventory: installations.slice(0, 5).map((installation) => ({
      id: installation.id,
      label: installation.name,
      detail: `${installation.model_version} // ${integer(installation.tag_count)} TAGS`,
      state: installation.status === "ready" ? "ready" : "attention",
    })),
  };
}

function dictionariesCategory(input: CapabilityLibraryOverviewInput): CapabilityLibraryCategory {
  const library = input.dictionaries;
  const installations = library?.installations ?? [];
  const ready = installations.filter((item) => item.status === "ready" && item.enabled).length;
  const issueCount =
    (library?.scan_issues?.length ?? 0) +
    installations.filter((item) => item.status !== "ready" || Boolean(item.issue)).length;
  const state = singleSourceState(input.sources.dictionaries, {
    empty: installations.length === 0,
    attention: issueCount > 0,
  });
  return {
    ...categoryDefinition("dictionaries"),
    state,
    stateLabel: stateLabel(state),
    headlineValue: integer(library?.entry_count ?? 0),
    headlineLabel: "INDEXED ENTRIES",
    summary:
      installations.length > 0
        ? `${integer(ready)} 个启用词典共同提供 ${integer(library?.entry_count ?? 0)} 条索引。`
        : "尚未安装 Tag 词典。",
    notice:
      state === "error"
        ? "词典索引当前不可用。"
        : issueCount > 0
          ? `${integer(issueCount)} 项词典状态需要检查。`
          : null,
    metrics: [
      { id: "libraries", label: "LIBRARIES", value: integer(installations.length) },
      { id: "active", label: "ACTIVE", value: integer(ready) },
      { id: "entries", label: "ENTRIES", value: integer(library?.entry_count ?? 0) },
      { id: "overrides", label: "OVERRIDES", value: integer(library?.override_count ?? 0) },
    ],
    inventory: installations.slice(0, 5).map((installation) => ({
      id: installation.id,
      label: installation.name,
      detail: `${installation.language.toUpperCase()} // ${integer(installation.entry_count)} ENTRIES`,
      state: installation.status === "ready" && installation.enabled ? "ready" : "attention",
    })),
  };
}

function promptsCategory(input: CapabilityLibraryOverviewInput): CapabilityLibraryCategory {
  const total = input.systemPrompts.length + input.translationPrompts.length;
  const state = combinedSourceState(
    [input.sources.systemPrompts, input.sources.translationPrompts],
    { empty: total === 0 },
  );
  const systemInventory = input.systemPrompts.map((prompt) => ({
    id: `system:${prompt.id}`,
    label: prompt.name,
    detail: "SYSTEM PROTOCOL",
    state: "ready" as const,
  }));
  const translationInventory = input.translationPrompts.map((prompt) => ({
    id: `translation:${prompt.id}`,
    label: prompt.name,
    detail: "TRANSLATION PROTOCOL",
    state: "ready" as const,
  }));
  return {
    ...categoryDefinition("prompts"),
    state,
    stateLabel: stateLabel(state),
    headlineValue: integer(total),
    headlineLabel: "ACTIVE PROTOCOLS",
    summary:
      total > 0
        ? `${integer(input.systemPrompts.length)} 个系统协议与 ${integer(input.translationPrompts.length)} 个翻译协议已登记。`
        : "尚未登记 Prompt 协议。",
    notice: state === "error" ? "Prompt 协议索引当前不可用。" : null,
    metrics: [
      { id: "system", label: "SYSTEM", value: integer(input.systemPrompts.length) },
      {
        id: "translation",
        label: "TRANSLATE",
        value: integer(input.translationPrompts.length),
      },
      { id: "total", label: "TOTAL", value: integer(total) },
      { id: "schema", label: "SCHEMA", value: "V2" },
    ],
    inventory: [...systemInventory, ...translationInventory].slice(0, 5),
  };
}

function systemCategory(input: CapabilityLibraryOverviewInput): CapabilityLibraryCategory {
  const diagnostics = input.diagnostics;
  const state = singleSourceState(input.sources.diagnostics, { empty: diagnostics === null });
  return {
    ...categoryDefinition("system"),
    state,
    stateLabel: stateLabel(state),
    headlineValue: diagnostics?.status === "ok" ? "01" : "00",
    headlineLabel: "STUDIO SERVICE",
    summary:
      diagnostics?.status === "ok"
        ? `Studio ${diagnostics.version} 正常响应，界面与通知状态已归档。`
        : "正在等待 Studio 诊断响应。",
    notice: state === "error" ? "Studio 诊断接口当前不可用。" : null,
    metrics: [
      { id: "service", label: "SERVICE", value: diagnostics?.status.toUpperCase() ?? "WAIT" },
      { id: "version", label: "VERSION", value: diagnostics?.version ?? "—" },
      { id: "theme", label: "INTERFACE", value: "DIAL R2" },
      {
        id: "announcement",
        label: "NOTICE",
        value: input.hasUnreadAnnouncement ? "NEW" : "READ",
      },
    ],
    inventory: [
      {
        id: "appearance",
        label: "界面外观",
        detail: "DIAL ARCHIVE // WARM WHITE",
        state: "ready",
      },
      {
        id: "announcements",
        label: "更新公告",
        detail: input.hasUnreadAnnouncement ? "UNREAD BULLETIN" : "ARCHIVE CURRENT",
        state: input.hasUnreadAnnouncement ? "attention" : "ready",
      },
      {
        id: "diagnostics",
        label: "运行诊断",
        detail: diagnostics
          ? `SERVICE ${diagnostics.status.toUpperCase()} // ${diagnostics.version}`
          : "WAITING",
        state: diagnostics ? "ready" : "attention",
      },
    ],
  };
}

export function createCapabilityLibraryOverview(
  input: CapabilityLibraryOverviewInput,
): CapabilityLibraryOverview {
  const sourceStates = Object.values(input.sources);
  const errorCount = sourceStates.filter((state) => state === "error").length;
  const loadingCount = sourceStates.filter((state) => state === "loading").length;
  const status: CapabilityLibraryOverview["status"] =
    errorCount === sourceStates.length
      ? "error"
      : errorCount > 0
        ? "partial-error"
        : loadingCount > 0
          ? "loading"
          : "ready";
  const message = input.errors?.length ? [...new Set(input.errors)].join(" / ") : null;

  return {
    status,
    categories: [
      providersCategory(input),
      taggersCategory(input),
      dictionariesCategory(input),
      promptsCategory(input),
      systemCategory(input),
    ],
    message,
  };
}
