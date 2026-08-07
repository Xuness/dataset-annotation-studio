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

export function isCapabilityLibraryCategoryId(
  value: string | null | undefined,
): value is CapabilityLibraryCategoryId {
  return CAPABILITY_LIBRARY_CATEGORY_IDS.includes(value as CapabilityLibraryCategoryId);
}

export type CapabilityLibraryLane = "primary" | "system";
export type CapabilityLibraryCategoryState = "loading" | "ready" | "attention" | "error";
export type CapabilityLibrarySourceState = "loading" | "ready" | "error";

export type CapabilityLibraryGroupId =
  | "connections"
  | "runtime"
  | "installations"
  | "profiles"
  | "downloads"
  | "overrides"
  | "system"
  | "translation"
  | "appearance"
  | "announcements"
  | "diagnostics";

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

export interface CapabilityLibraryGroupDefinition {
  id: CapabilityLibraryGroupId;
  code: string;
  label: string;
  englishLabel: string;
  description: string;
}

export interface CapabilityLibraryGroup extends CapabilityLibraryGroupDefinition {
  count: number;
}

export const CAPABILITY_LIBRARY_GROUP_DEFINITIONS = {
  providers: [
    {
      id: "connections",
      code: "CON",
      label: "连接档案",
      englishLabel: "Connections",
      description: "认证、并发、默认路由与逐模型生成参数。",
    },
  ],
  taggers: [
    {
      id: "profiles",
      code: "PRF",
      label: "执行配置",
      englishLabel: "Execution Profiles",
      description: "为不同模型分别配置阈值、类别、设备与批大小。",
    },
    {
      id: "installations",
      code: "MDL",
      label: "模型安装",
      englishLabel: "Model Installations",
      description: "检查本地模型文件、适配器、版本与完整性。",
    },
    {
      id: "runtime",
      code: "RUN",
      label: "运行时",
      englishLabel: "Tagger Runtime",
      description: "管理模型根目录、可用设备、提供方与扫描问题。",
    },
    {
      id: "downloads",
      code: "DLQ",
      label: "下载中心",
      englishLabel: "Download Center",
      description: "维护模型目录、Hugging Face 连接与可恢复下载任务。",
    },
  ],
  dictionaries: [
    {
      id: "installations",
      code: "STK",
      label: "优先级词典",
      englishLabel: "Priority Stack",
      description: "按优先级组织词典安装、授权、来源与启停状态。",
    },
    {
      id: "overrides",
      code: "OVR",
      label: "全局修正",
      englishLabel: "Global Corrections",
      description: "搜索有效解析并维护独立人工翻译与分类覆盖。",
    },
    {
      id: "downloads",
      code: "DLQ",
      label: "下载中心",
      englishLabel: "Download Center",
      description: "查看在线目录、授权确认与词典下载任务。",
    },
  ],
  prompts: [
    {
      id: "system",
      code: "SYS",
      label: "系统协议",
      englishLabel: "System Protocols",
      description: "描述、分析与模型调用使用的系统级协议。",
    },
    {
      id: "translation",
      code: "TRN",
      label: "翻译协议",
      englishLabel: "Translation Protocols",
      description: "结构保留翻译任务使用的独立长文本协议。",
    },
  ],
  system: [
    {
      id: "appearance",
      code: "VIS",
      label: "界面外观",
      englishLabel: "Appearance",
      description: "管理当前 V2 界面真正生效的设备本地视觉偏好。",
    },
    {
      id: "announcements",
      code: "BLT",
      label: "更新公告",
      englishLabel: "Bulletins",
      description: "浏览版本历史、发布详情与本地已读状态。",
    },
    {
      id: "diagnostics",
      code: "DGN",
      label: "运行诊断",
      englishLabel: "Diagnostics",
      description: "检查前后端版本、健康状态、路径与脱敏摘要。",
    },
  ],
} as const satisfies Readonly<
  Record<CapabilityLibraryCategoryId, readonly CapabilityLibraryGroupDefinition[]>
>;

export interface CapabilityLibraryMetric {
  id: string;
  label: string;
  value: string;
  unit?: string;
}

export interface CapabilityLibraryInventoryItem {
  id: string;
  routeId: string;
  groupId: CapabilityLibraryGroupId;
  label: string;
  detail: string;
  state: "ready" | "attention";
  kindLabel: string;
  summary: string;
  facts: readonly CapabilityLibraryMetric[];
  tags: readonly string[];
  workbenchPath: string;
  actionLabel: string;
}

export interface CapabilityLibraryCategory extends CapabilityLibraryCategoryDefinition {
  state: CapabilityLibraryCategoryState;
  stateLabel: string;
  headlineValue: string;
  headlineLabel: string;
  summary: string;
  notice: string | null;
  metrics: readonly CapabilityLibraryMetric[];
  groups: readonly CapabilityLibraryGroup[];
  defaultGroupId: CapabilityLibraryGroupId;
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
  openCategory(categoryId: CapabilityLibraryCategoryId): void;
  refresh(): void;
}

export interface CapabilityCategoryContent {
  kind: "capability-category";
  status: CapabilityLibraryOverview["status"];
  categories: readonly CapabilityLibraryCategory[];
  category: CapabilityLibraryCategory;
  groups: readonly CapabilityLibraryGroup[];
  activeGroupId: CapabilityLibraryGroupId;
  activeGroup: CapabilityLibraryGroup;
  resources: readonly CapabilityLibraryInventoryItem[];
  activeResourceId: string | null;
  activeResource: CapabilityLibraryInventoryItem | null;
  createResourceLabel: string | null;
  message: string | null;
  selectCategory(categoryId: CapabilityLibraryCategoryId): void;
  selectGroup(groupId: CapabilityLibraryGroupId): void;
  selectResource(resourceId: string): void;
  openResource(resourceId: string): void;
  createResource(): void;
  openActiveResource(): void;
  returnOverview(): void;
  refresh(): void;
}

export type CapabilityDownloadCategoryId = "taggers" | "dictionaries";

export interface CapabilityDownloadOfferItem {
  id: string;
  label: string;
  detail: string;
  description: string;
  sourceLabel: string;
  revision: string;
  size: string;
  licenseLabel: string;
  state: "available" | "active" | "installed" | "manual";
  canStart: boolean;
  sourceUrl: string;
  licenseUrl: string;
}

export interface CapabilityDownloadTaskItem {
  id: string;
  label: string;
  detail: string;
  status: string;
  progress: number;
  transferred: string;
  currentFile: string | null;
  error: string | null;
  canPause: boolean;
  canResume: boolean;
  canRemove: boolean;
}

export interface CapabilityDownloadWorkbenchContent {
  kind: "capability-download-workbench";
  status: "loading" | "ready" | "error";
  categoryId: CapabilityDownloadCategoryId;
  code: "TAG" | "DIC";
  label: string;
  englishLabel: string;
  description: string;
  offers: readonly CapabilityDownloadOfferItem[];
  tasks: readonly CapabilityDownloadTaskItem[];
  pending: boolean;
  message: string | null;
  startOffer(offerId: string): Promise<void>;
  pauseTask(taskId: string): Promise<void>;
  resumeTask(taskId: string): Promise<void>;
  removeTask(taskId: string): Promise<void>;
  openSource(offerId: string): Promise<void>;
  openLicense(offerId: string): Promise<void>;
  refresh(): void;
  returnCategory(): void;
  returnOverview(): void;
}

export type CapabilitySystemSectionId = "appearance" | "announcements" | "diagnostics";

export interface CapabilitySystemAnnouncementItem {
  id: string;
  version: string;
  publishedAt: string;
  title: string;
  summary: string;
  sectionCount: number;
  sections: readonly {
    kind: string;
    title: string;
    items: readonly string[];
  }[];
}

export interface CapabilitySystemWorkbenchContent {
  kind: "capability-system-workbench";
  status: "loading" | "ready" | "error";
  sectionId: CapabilitySystemSectionId;
  title: string;
  englishLabel: string;
  description: string;
  announcements: readonly CapabilitySystemAnnouncementItem[];
  hasUnreadAnnouncement: boolean;
  appearance: {
    themeId: string;
    palette: string;
    baseline: string;
    preferenceScope: string;
  };
  diagnostics: {
    frontendVersion: string;
    buildChannel: string;
    runtime: string;
    serviceStatus: string;
    backendVersion: string;
    apiBaseUrl: string;
    appDataDir: string;
    logDir: string;
  };
  canOpenLogs: boolean;
  pending: boolean;
  message: string | null;
  markLatestAnnouncementRead(): void;
  openLogs(): Promise<void>;
  copyDiagnosticSummary(): Promise<void>;
  refresh(): void;
  selectSection(sectionId: CapabilitySystemSectionId): void;
  returnCategory(): void;
  returnOverview(): void;
}

const INTEGER_FORMATTER = new Intl.NumberFormat("en-US");

function integer(value: number): string {
  return INTEGER_FORMATTER.format(value);
}

function dateStamp(value: string): string {
  return value.slice(0, 10).replaceAll("-", ".") || "—";
}

function endpointLabel(value: string): string {
  try {
    return new URL(value).host.toUpperCase();
  } catch {
    return value || "CUSTOM ENDPOINT";
  }
}

function categoryDefinition(id: CapabilityLibraryCategoryId): CapabilityLibraryCategoryDefinition {
  const definition = CAPABILITY_LIBRARY_CATEGORY_DEFINITIONS.find((item) => item.id === id);
  if (!definition) throw new Error(`Unknown capability library category: ${id}`);
  return definition;
}

function categoryGroups(
  categoryId: CapabilityLibraryCategoryId,
  inventory: readonly CapabilityLibraryInventoryItem[],
): readonly CapabilityLibraryGroup[] {
  return CAPABILITY_LIBRARY_GROUP_DEFINITIONS[categoryId].map((group) => ({
    ...group,
    count: inventory.filter((item) => item.groupId === group.id).length,
  }));
}

function routeSegment(value: string): string {
  return encodeURIComponent(value);
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
  const inventory: CapabilityLibraryInventoryItem[] = input.providers.map((profile) => ({
    id: profile.id,
    routeId: profile.id,
    groupId: "connections",
    label: profile.name,
    detail: `${profile.provider_type.toUpperCase()} // ${profile.default_model_id || "NO DEFAULT"}`,
    state: profile.models.length > 0 ? "ready" : "attention",
    kindLabel: "PROVIDER PROFILE",
    summary: `${endpointLabel(profile.base_url)} 上登记了 ${integer(profile.models.length)} 个可调用模型；默认路由为 ${profile.default_model_id || "未指定"}。每个模型的生成参数在四级工作台中独立维护。`,
    facts: [
      { id: "type", label: "PROTOCOL", value: profile.provider_type.toUpperCase() },
      { id: "default", label: "DEFAULT", value: profile.default_model_id || "—" },
      { id: "models", label: "MODELS", value: integer(profile.models.length) },
      { id: "parallel", label: "PARALLEL", value: integer(profile.concurrency) },
      { id: "credential", label: "CREDENTIAL", value: profile.has_api_key ? "SEALED" : "NONE" },
      { id: "updated", label: "UPDATED", value: dateStamp(profile.updated_at) },
    ],
    tags: profile.models.slice(0, 5).map((model) => model.model_id),
    workbenchPath: `/capability/providers/profile/${routeSegment(profile.id)}`,
    actionLabel: "配置连接与逐模型参数",
  }));
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
    groups: categoryGroups("providers", inventory),
    defaultGroupId: "connections",
    inventory,
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
  const profileInventory: CapabilityLibraryInventoryItem[] = profiles.map((profile) => ({
    id: `profile-${profile.id}`,
    routeId: profile.id,
    groupId: "profiles",
    label: profile.name,
    detail: `${profile.installation_name || profile.model_version || "UNBOUND MODEL"} // ${profile.device.toUpperCase()}`,
    state: profile.ready ? "ready" : "attention",
    kindLabel: "EXECUTION PROFILE",
    summary: `${profile.installation_name || "本地模型"} 的独立执行配置；采用 ${profile.selection.mode.toUpperCase()} 选择策略、${profile.selection.global_threshold.toFixed(2)} 回退阈值与 ${profile.batch_size ?? "AUTO"} 批大小。`,
    facts: [
      { id: "model", label: "MODEL", value: profile.installation_name || "—" },
      { id: "selection", label: "SELECTION", value: profile.selection.mode.toUpperCase() },
      {
        id: "threshold",
        label: "THRESHOLD",
        value: profile.selection.global_threshold.toFixed(2),
      },
      { id: "categories", label: "CATEGORIES", value: integer(profile.categories.length) },
      { id: "device", label: "DEVICE", value: profile.device.toUpperCase() },
      {
        id: "batch",
        label: "BATCH",
        value: profile.batch_size ? integer(profile.batch_size) : "AUTO",
      },
    ],
    tags: [
      profile.model_version || "MODEL PROFILE",
      ...profile.categories.slice(0, 5),
      profile.selection.max_tags ? `MAX ${profile.selection.max_tags}` : "NO TAG CAP",
    ],
    workbenchPath: `/capability/taggers/profile/${routeSegment(profile.id)}`,
    actionLabel: "编辑模型执行参数",
  }));
  const installationInventory: CapabilityLibraryInventoryItem[] = installations.map(
    (installation) => ({
      id: installation.id,
      routeId: installation.id,
      groupId: "installations",
      label: installation.name,
      detail: `${installation.model_version} // ${integer(installation.tag_count)} TAGS`,
      state: installation.status === "ready" ? "ready" : "attention",
      kindLabel: "TAGGER INSTALLATION",
      summary: `${installation.adapter_name} 适配器已索引 ${integer(installation.tag_count)} 个标签，模型版本 ${installation.model_version}。安装档案与执行 Profile 分开管理。`,
      facts: [
        { id: "adapter", label: "ADAPTER", value: installation.adapter_id.toUpperCase() },
        { id: "version", label: "VERSION", value: installation.model_version },
        { id: "tags", label: "TAG COUNT", value: integer(installation.tag_count) },
        { id: "disk", label: "VOLUME", value: formatBytes(installation.disk_size) },
        {
          id: "profiles",
          label: "PROFILES",
          value: integer(
            profiles.filter((profile) => profile.installation_id === installation.id).length,
          ),
        },
        { id: "updated", label: "UPDATED", value: dateStamp(installation.updated_at) },
      ],
      tags: Object.keys(installation.categories ?? {}).slice(0, 6),
      workbenchPath: `/capability/taggers/installation/${routeSegment(installation.id)}`,
      actionLabel: "检查安装与模型文件",
    }),
  );
  const runtimeInventory: CapabilityLibraryInventoryItem[] = [
    {
      id: "runtime",
      routeId: "runtime",
      groupId: "runtime",
      label: "本地推理运行时",
      detail: library?.runtime.available ? "RUNTIME AVAILABLE" : "RUNTIME REQUIRES CHECK",
      state: library?.runtime.available ? "ready" : "attention",
      kindLabel: "TAGGER RUNTIME",
      summary: library
        ? `运行时报告 ${integer(library.runtime.devices?.length ?? 0)} 个可用设备和 ${integer(library.runtime.providers?.length ?? 0)} 个推理提供方；模型根目录独立于执行 Profile。`
        : "等待本地打标运行时索引响应。",
      facts: [
        {
          id: "status",
          label: "RUNTIME",
          value: library?.runtime.available ? "AVAILABLE" : "CHECK",
        },
        { id: "devices", label: "DEVICES", value: integer(library?.runtime.devices?.length ?? 0) },
        {
          id: "providers",
          label: "PROVIDERS",
          value: integer(library?.runtime.providers?.length ?? 0),
        },
        { id: "installs", label: "INSTALLS", value: integer(installations.length) },
        { id: "issues", label: "SCAN ISSUES", value: integer(library?.scan_issues?.length ?? 0) },
      ],
      tags: [...(library?.runtime.devices ?? []), ...(library?.runtime.providers ?? [])],
      workbenchPath: "/capability/taggers/runtime",
      actionLabel: "管理本地推理运行时",
    },
  ];
  const downloadInventory: CapabilityLibraryInventoryItem[] = [
    {
      id: "downloads",
      routeId: "downloads",
      groupId: "downloads",
      label: "模型下载中心",
      detail: "CURATED LIBRARY // HUGGING FACE",
      state: "ready",
      kindLabel: "TAGGER DOWNLOAD WORKBENCH",
      summary: "独立管理内置模型目录、Hugging Face 连接、授权确认与支持暂停／继续的下载任务。",
      facts: [
        { id: "catalog", label: "CATALOG", value: "CURATED + HF" },
        { id: "license", label: "LICENSE", value: "CONFIRM" },
        { id: "queue", label: "QUEUE", value: "RECOVERABLE" },
        { id: "scope", label: "SCOPE", value: "TAGGER MODELS" },
      ],
      tags: ["DOWNLOAD TASKS", "PAUSE / RESUME", "FIXED REVISION"],
      workbenchPath: "/capability/taggers/downloads",
      actionLabel: "打开模型下载中心",
    },
  ];
  const inventory = [
    ...profileInventory,
    ...installationInventory,
    ...runtimeInventory,
    ...downloadInventory,
  ];
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
    groups: categoryGroups("taggers", inventory),
    defaultGroupId: "profiles",
    inventory,
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
  const installationInventory: CapabilityLibraryInventoryItem[] = installations.map(
    (installation) => ({
      id: installation.id,
      routeId: installation.id,
      groupId: "installations",
      label: installation.name,
      detail: `${installation.language.toUpperCase()} // ${integer(installation.entry_count)} ENTRIES`,
      state: installation.status === "ready" && installation.enabled ? "ready" : "attention",
      kindLabel: "DICTIONARY INSTALLATION",
      summary: `${installation.language.toUpperCase()} 词典由 ${installation.adapter_id} 适配器装载，以优先级 ${integer(installation.priority)} 参与本地覆盖。`,
      facts: [
        { id: "entries", label: "ENTRIES", value: integer(installation.entry_count) },
        { id: "language", label: "LANGUAGE", value: installation.language.toUpperCase() },
        { id: "priority", label: "PRIORITY", value: integer(installation.priority) },
        { id: "license", label: "LICENSE", value: installation.license_status.toUpperCase() },
        { id: "enabled", label: "INDEX", value: installation.enabled ? "ENABLED" : "PAUSED" },
        { id: "updated", label: "UPDATED", value: dateStamp(installation.updated_at) },
      ],
      tags: [installation.adapter_id, installation.source_version, installation.status].filter(
        Boolean,
      ),
      workbenchPath: `/capability/dictionaries/installation/${routeSegment(installation.id)}`,
      actionLabel: "管理词典与优先级",
    }),
  );
  const utilityInventory: CapabilityLibraryInventoryItem[] = [
    {
      id: "overrides",
      routeId: "overrides",
      groupId: "overrides",
      label: "全局词条修正",
      detail: `${integer(library?.override_count ?? 0)} OVERRIDES // ZH-CN`,
      state: "ready",
      kindLabel: "DICTIONARY CORRECTION WORKBENCH",
      summary: "在不修改基础词典文件的前提下，检索有效解析并维护翻译与分类的人工覆盖。",
      facts: [
        { id: "overrides", label: "OVERRIDES", value: integer(library?.override_count ?? 0) },
        { id: "entries", label: "BASE ENTRIES", value: integer(library?.entry_count ?? 0) },
        { id: "libraries", label: "LIBRARIES", value: integer(installations.length) },
        { id: "language", label: "LANGUAGE", value: "ZH-CN" },
      ],
      tags: ["SEARCH DRIVEN", "BASE READ-ONLY", "GLOBAL LAYER"],
      workbenchPath: "/capability/dictionaries/overrides",
      actionLabel: "打开全局修正工作台",
    },
    {
      id: "downloads",
      routeId: "downloads",
      groupId: "downloads",
      label: "词典下载中心",
      detail: "ONLINE CATALOG // LICENSE GATE",
      state: "ready",
      kindLabel: "DICTIONARY DOWNLOAD WORKBENCH",
      summary: "独立查看在线词典目录、来源授权与支持暂停／继续的安装任务，不与优先级编辑混放。",
      facts: [
        { id: "catalog", label: "CATALOG", value: "ONLINE" },
        { id: "license", label: "LICENSE", value: "CONFIRM" },
        { id: "queue", label: "QUEUE", value: "RECOVERABLE" },
        { id: "scope", label: "SCOPE", value: "TAG DICTIONARIES" },
      ],
      tags: ["DOWNLOAD TASKS", "MANUAL SOURCE", "PAUSE / RESUME"],
      workbenchPath: "/capability/dictionaries/downloads",
      actionLabel: "打开词典下载中心",
    },
  ];
  const inventory = [...installationInventory, ...utilityInventory];
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
    groups: categoryGroups("dictionaries", inventory),
    defaultGroupId: "installations",
    inventory,
  };
}

function promptsCategory(input: CapabilityLibraryOverviewInput): CapabilityLibraryCategory {
  const total = input.systemPrompts.length + input.translationPrompts.length;
  const state = combinedSourceState(
    [input.sources.systemPrompts, input.sources.translationPrompts],
    { empty: total === 0 },
  );
  const systemInventory: CapabilityLibraryInventoryItem[] = input.systemPrompts.map((prompt) => ({
    id: `system-${prompt.id}`,
    routeId: prompt.id,
    groupId: "system",
    label: prompt.name,
    detail: "SYSTEM PROTOCOL",
    state: "ready" as const,
    kindLabel: "SYSTEM PROMPT",
    summary: `系统协议正文共 ${integer(prompt.system_prompt.length)} 个字符；三级名册仅显示结构信息，不展开敏感提示词。`,
    facts: [
      { id: "class", label: "CLASS", value: "SYSTEM" },
      { id: "length", label: "LENGTH", value: integer(prompt.system_prompt.length), unit: "CHAR" },
      { id: "schema", label: "SCHEMA", value: "V2" },
      { id: "updated", label: "UPDATED", value: dateStamp(prompt.updated_at) },
      { id: "created", label: "CREATED", value: dateStamp(prompt.created_at) },
    ],
    tags: ["SYSTEM", "TEXT PROTOCOL", "LEVEL 04 EDITOR"],
    workbenchPath: `/capability/prompts/system/${routeSegment(prompt.id)}`,
    actionLabel: "编辑系统协议正文",
  }));
  const translationInventory: CapabilityLibraryInventoryItem[] = input.translationPrompts.map(
    (prompt) => ({
      id: `translation-${prompt.id}`,
      routeId: prompt.id,
      groupId: "translation",
      label: prompt.name,
      detail: "TRANSLATION PROTOCOL",
      state: "ready" as const,
      kindLabel: "TRANSLATION PROMPT",
      summary: `翻译协议正文共 ${integer(prompt.system_prompt.length)} 个字符；正文将在四级编辑器中按受控权限展开。`,
      facts: [
        { id: "class", label: "CLASS", value: "TRANSLATION" },
        {
          id: "length",
          label: "LENGTH",
          value: integer(prompt.system_prompt.length),
          unit: "CHAR",
        },
        { id: "schema", label: "SCHEMA", value: "V2" },
        { id: "updated", label: "UPDATED", value: dateStamp(prompt.updated_at) },
        { id: "created", label: "CREATED", value: dateStamp(prompt.created_at) },
      ],
      tags: ["TRANSLATION", "STRUCTURE SAFE", "LEVEL 04 EDITOR"],
      workbenchPath: `/capability/prompts/translation/${routeSegment(prompt.id)}`,
      actionLabel: "编辑翻译协议正文",
    }),
  );
  const inventory = [...systemInventory, ...translationInventory];
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
    groups: categoryGroups("prompts", inventory),
    defaultGroupId: "system",
    inventory,
  };
}

function systemCategory(input: CapabilityLibraryOverviewInput): CapabilityLibraryCategory {
  const diagnostics = input.diagnostics;
  const state = singleSourceState(input.sources.diagnostics, { empty: diagnostics === null });
  const inventory: CapabilityLibraryInventoryItem[] = [
    {
      id: "appearance",
      routeId: "appearance",
      groupId: "appearance",
      label: "界面外观",
      detail: "DIAL ARCHIVE // WARM WHITE",
      state: "ready",
      kindLabel: "STUDIO APPEARANCE",
      summary: "当前界面采用暖白纸面、碳黑信息层与受控工业黄的经典终末地视觉协议。",
      facts: [
        { id: "theme", label: "THEME", value: "DIAL ARCHIVE" },
        { id: "palette", label: "PALETTE", value: "WARM WHITE" },
        { id: "density", label: "DENSITY", value: "OPERATIONAL" },
        { id: "baseline", label: "BASELINE", value: "2560×1440" },
      ],
      tags: ["R2", "HARD EDGE", "CONTROLLED YELLOW"],
      workbenchPath: "/capability/system/appearance",
      actionLabel: "管理 V2 外观偏好",
    },
    {
      id: "announcements",
      routeId: "announcements",
      groupId: "announcements",
      label: "更新公告",
      detail: input.hasUnreadAnnouncement ? "UNREAD BULLETIN" : "ARCHIVE CURRENT",
      state: input.hasUnreadAnnouncement ? "attention" : "ready",
      kindLabel: "STUDIO BULLETIN",
      summary: input.hasUnreadAnnouncement
        ? "存在尚未阅读的 Studio 更新公告，建议在进入生产流程前完成确认。"
        : "更新公告已读，当前本地阅读状态与公告归档一致。",
      facts: [
        {
          id: "read-state",
          label: "READ STATE",
          value: input.hasUnreadAnnouncement ? "UNREAD" : "CURRENT",
        },
        { id: "channel", label: "CHANNEL", value: "LOCAL STUDIO" },
        { id: "scope", label: "SCOPE", value: "RELEASE NOTES" },
        { id: "archive", label: "ARCHIVE", value: "AVAILABLE" },
      ],
      tags: ["NOTICE", "LOCAL STATE", "RELEASE CHANNEL"],
      workbenchPath: "/capability/system/announcements",
      actionLabel: "浏览更新公告",
    },
    {
      id: "diagnostics",
      routeId: "diagnostics",
      groupId: "diagnostics",
      label: "运行诊断",
      detail: diagnostics
        ? `SERVICE ${diagnostics.status.toUpperCase()} // ${diagnostics.version}`
        : "WAITING",
      state: diagnostics ? "ready" : "attention",
      kindLabel: "SYSTEM DIAGNOSTICS",
      summary: diagnostics
        ? `Studio ${diagnostics.version} 已响应；应用数据与日志目录由本地运行时托管。`
        : "诊断服务尚未返回可验证的运行状态。",
      facts: [
        { id: "service", label: "SERVICE", value: diagnostics?.status.toUpperCase() ?? "WAIT" },
        { id: "version", label: "VERSION", value: diagnostics?.version ?? "—" },
        { id: "data", label: "APP DATA", value: diagnostics ? "MOUNTED" : "WAIT" },
        { id: "logs", label: "LOG STREAM", value: diagnostics ? "AVAILABLE" : "WAIT" },
      ],
      tags: ["LOCAL RUNTIME", "HEALTH CHECK", "LOG INDEX"],
      workbenchPath: "/capability/system/diagnostics",
      actionLabel: "打开运行诊断",
    },
  ];
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
    groups: categoryGroups("system", inventory),
    defaultGroupId: "appearance",
    inventory,
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
