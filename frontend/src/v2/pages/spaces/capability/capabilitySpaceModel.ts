import type {
  ProviderProfile,
  ProviderType,
  SystemPreset,
  TagDictionaryLibrary,
  TaggerLibrary,
  TranslationPromptPreset,
} from "../../../../shared/api/types";
import { formatBytes } from "../../../../shared/format/bytes";
import type {
  CapabilityBranchRecord,
  CapabilityDistrictId,
  CapabilityDistrictRecord,
  CapabilityObjectKind,
  CapabilityObjectRecord,
  CapabilitySignalTone,
} from "../spacePageModel";

export interface CapabilityInventoryInput {
  providers: readonly ProviderProfile[];
  taggers: TaggerLibrary | null;
  dictionaries: TagDictionaryLibrary | null;
  systemPrompts: readonly SystemPreset[];
  translationPrompts: readonly TranslationPromptPreset[];
}

export interface CapabilityRouteSelection {
  districtId: CapabilityDistrictId | null;
  kind: CapabilityObjectKind | null;
  routeId: string | null;
}

const PROVIDER_PRESENTATION: Readonly<
  Record<ProviderType, { code: string; label: string; englishLabel: string }>
> = {
  openrouter: { code: "RTR", label: "聚合路由", englishLabel: "OPENROUTER" },
  openai_compatible: { code: "CMP", label: "兼容协议", englishLabel: "OPENAI COMPATIBLE" },
  opencode_go: { code: "OCG", label: "开放编码", englishLabel: "OPENCODE GO" },
  gemini: { code: "GEM", label: "原生协议", englishLabel: "GEMINI" },
  codex: { code: "CDX", label: "账户会话", englishLabel: "CODEX" },
};

function compactText(value: string, limit = 76): string {
  const compact = value.replace(/\s+/gu, " ").trim();
  if (!compact) return "尚未写入内容";
  return compact.length > limit ? `${compact.slice(0, limit).trimEnd()}…` : compact;
}

function statusFromCount(count: number): CapabilitySignalTone {
  return count > 0 ? "ready" : "attention";
}

function providerObject(profile: ProviderProfile, index: number): CapabilityObjectRecord {
  const protocol = PROVIDER_PRESENTATION[profile.provider_type];
  const apiKeyExpected = profile.provider_type !== "codex";
  const connectionReady = !apiKeyExpected || profile.has_api_key || profile.base_url.length > 0;
  const status: CapabilitySignalTone =
    profile.models.length > 0 && connectionReady ? "ready" : "attention";
  const defaultModel = profile.models.find((model) => model.model_id === profile.default_model_id);
  return {
    id: `provider:${profile.id}`,
    routeId: profile.id,
    districtId: "providers",
    branchId: profile.provider_type,
    kind: "provider",
    code: `${protocol.code}-${String(index + 1).padStart(2, "0")}`,
    name: profile.name,
    englishName: protocol.englishLabel,
    summary: profile.base_url || "使用本机会话协议",
    status,
    statusLabel: status === "ready" ? "可供调用" : "需要配置",
    readings: [
      { label: "协议", value: protocol.englishLabel },
      { label: "模型", value: `${profile.models.length}` },
      { label: "并发", value: `${profile.concurrency}` },
      {
        label: "认证",
        value:
          profile.provider_type === "codex"
            ? "ACCOUNT"
            : profile.has_api_key
              ? "READY"
              : "OPTIONAL",
        tone: connectionReady ? "ready" : "attention",
      },
    ],
    items: profile.models.map((model) => ({
      id: model.model_id,
      label: model.model_id,
      value: model.model_id === profile.default_model_id ? "DEFAULT" : "MODEL",
      active: model.model_id === profile.default_model_id,
      tone: model.model_id === profile.default_model_id ? "ready" : "neutral",
    })),
    body: defaultModel ? JSON.stringify(defaultModel.protocol_options, null, 2) : null,
    updatedAt: profile.updated_at,
  };
}

function providerDistrict(profiles: readonly ProviderProfile[]): CapabilityDistrictRecord {
  const objects = profiles.map(providerObject);
  const branches = (
    Object.keys(PROVIDER_PRESENTATION) as ProviderType[]
  ).map<CapabilityBranchRecord>((type) => {
    const presentation = PROVIDER_PRESENTATION[type];
    const objectIds = objects
      .filter((object) => object.branchId === type)
      .map((object) => object.id);
    return {
      id: type,
      code: presentation.code,
      name: presentation.label,
      englishName: presentation.englishLabel,
      summary: objectIds.length ? `${objectIds.length} 个接入配置` : "等待接入",
      count: objectIds.length,
      status: statusFromCount(objectIds.length),
      objectIds,
    };
  });
  const modelCount = profiles.reduce((total, profile) => total + profile.models.length, 0);
  return {
    id: "providers",
    code: "PVD",
    index: "A1",
    name: "模型接入",
    englishName: "PROVIDER NETWORK",
    summary: "远程模型、认证通道与协议端口组成的分叉网络。",
    inventoryLabel: "PROFILE / MODEL",
    inventoryValue: `${profiles.length} / ${modelCount}`,
    status: statusFromCount(profiles.length),
    branches,
    objects,
  };
}

function taggerDistrict(library: TaggerLibrary | null): CapabilityDistrictRecord {
  const installations = library?.installations ?? [];
  const profiles = library?.profiles ?? [];
  const runtime = library?.runtime;
  const objects: CapabilityObjectRecord[] = [];
  objects.push({
    id: "tagger-runtime:runtime",
    routeId: "runtime",
    districtId: "taggers",
    branchId: "runtime",
    kind: "tagger-runtime",
    code: "RUN-00",
    name: "本地推理运行时",
    englishName: "LOCAL INFERENCE RUNTIME",
    summary: runtime?.error || "设备、执行提供程序与模型根目录状态",
    status: runtime?.available ? "ready" : runtime ? "offline" : "attention",
    statusLabel: runtime?.available ? "运行时可用" : runtime ? "运行时离线" : "等待索引",
    readings: [
      {
        label: "可用",
        value: runtime?.available ? "YES" : "NO",
        tone: runtime?.available ? "ready" : runtime ? "offline" : "attention",
      },
      { label: "设备", value: `${runtime?.devices?.length ?? 0}` },
      { label: "后端", value: `${runtime?.providers?.length ?? 0}` },
    ],
    items: [
      ...(runtime?.devices ?? []).map((device) => ({
        id: `device:${device}`,
        label: device,
        value: "DEVICE",
      })),
      ...(runtime?.providers ?? []).map((provider) => ({
        id: `provider:${provider}`,
        label: provider,
        value: "RUNTIME",
      })),
    ],
    body: runtime?.error ?? null,
    updatedAt: null,
  });
  installations.forEach((installation, index) => {
    const status: CapabilitySignalTone = installation.status === "ready" ? "ready" : "attention";
    objects.push({
      id: `tagger-installation:${installation.id}`,
      routeId: installation.id,
      districtId: "taggers",
      branchId: "installations",
      kind: "tagger-installation",
      code: `INS-${String(index + 1).padStart(2, "0")}`,
      name: installation.name,
      englishName: installation.adapter_name,
      summary: `${installation.model_version || "未标版本"} · ${installation.relative_path}`,
      status,
      statusLabel: installation.status === "ready" ? "安装可用" : installation.status.toUpperCase(),
      readings: [
        { label: "标签", value: installation.tag_count.toLocaleString("zh-CN") },
        { label: "体积", value: formatBytes(installation.disk_size) },
        { label: "类别", value: `${Object.keys(installation.categories ?? {}).length}` },
        { label: "文件", value: `${installation.files?.length ?? 0}` },
      ],
      items: Object.entries(installation.categories ?? {}).map(([category, count]) => ({
        id: category,
        label: category,
        value: Number(count).toLocaleString("zh-CN"),
      })),
      body: [...(installation.issues ?? []), ...(installation.warnings ?? [])].join("\n") || null,
      updatedAt: installation.updated_at,
    });
  });
  profiles.forEach((profile, index) => {
    objects.push({
      id: `tagger-profile:${profile.id}`,
      routeId: profile.id,
      districtId: "taggers",
      branchId: "profiles",
      kind: "tagger-profile",
      code: `PRF-${String(index + 1).padStart(2, "0")}`,
      name: profile.name,
      englishName: profile.installation_name || "REUSABLE PROFILE",
      summary: `${profile.selection.mode.toUpperCase()} · ${profile.device.toUpperCase()}`,
      status: profile.ready ? "ready" : "attention",
      statusLabel: profile.ready ? "配置可用" : "需要检查",
      readings: [
        { label: "阈值", value: profile.selection.global_threshold.toFixed(2) },
        { label: "并发", value: `${profile.concurrency}` },
        { label: "设备", value: profile.device.toUpperCase() },
        { label: "类别", value: `${profile.categories.length}` },
      ],
      items: profile.categories.map((category) => ({
        id: category,
        label: category,
        value: "CATEGORY",
      })),
      body: profile.issue ?? null,
      updatedAt: profile.updated_at,
    });
  });
  const branchDefinitions = [
    ["runtime", "RUN", "运行时", "RUNTIME / DEVICE"],
    ["installations", "INS", "模型安装", "INSTALLATIONS"],
    ["profiles", "PRF", "复用配置", "PROFILES"],
  ] as const;
  const branches = branchDefinitions.map<CapabilityBranchRecord>(
    ([id, code, name, englishName]) => {
      const objectIds = objects
        .filter((object) => object.branchId === id)
        .map((object) => object.id);
      return {
        id,
        code,
        name,
        englishName,
        summary: objectIds.length ? `${objectIds.length} 个空间对象` : "等待扫描",
        count: objectIds.length,
        status: statusFromCount(objectIds.length),
        objectIds,
      };
    },
  );
  return {
    id: "taggers",
    code: "TAG",
    index: "B2",
    name: "本地标注",
    englishName: "TAGGER ARRAY",
    summary: "运行时、模型安装和复用 Profile 形成三条并行廊道。",
    inventoryLabel: "INSTALL / PROFILE",
    inventoryValue: `${installations.length} / ${profiles.length}`,
    status: statusFromCount(installations.length + profiles.length),
    branches,
    objects,
  };
}

function dictionaryDistrict(library: TagDictionaryLibrary | null): CapabilityDistrictRecord {
  const installations = [...(library?.installations ?? [])].sort(
    (left, right) => left.priority - right.priority,
  );
  const objects: CapabilityObjectRecord[] = installations.map((installation, index) => {
    const status: CapabilitySignalTone =
      installation.status !== "ready" || !installation.enabled
        ? "attention"
        : installation.license_status === "undeclared"
          ? "attention"
          : "ready";
    return {
      id: `dictionary:${installation.id}`,
      routeId: installation.id,
      districtId: "dictionaries",
      branchId: "stack",
      kind: "dictionary",
      code: `DIC-${String(index + 1).padStart(2, "0")}`,
      name: installation.name,
      englishName: installation.adapter_id.toUpperCase(),
      summary: `${installation.language} · ${installation.source_version || "未标版本"}`,
      status,
      statusLabel: installation.enabled ? installation.status.toUpperCase() : "已停用",
      readings: [
        { label: "优先级", value: `${installation.priority}` },
        { label: "词条", value: installation.entry_count.toLocaleString("zh-CN") },
        { label: "体积", value: formatBytes(installation.disk_size) },
        {
          label: "授权",
          value: installation.license_status.toUpperCase(),
          tone: installation.license_status === "verified" ? "ready" : "attention",
        },
      ],
      items: [
        {
          id: "source",
          label: installation.source_id || "LOCAL",
          value: installation.source_version || "SOURCE",
        },
        { id: "fingerprint", label: installation.fingerprint.slice(0, 16), value: "FINGERPRINT" },
      ],
      body: installation.issue ?? null,
      updatedAt: installation.updated_at,
    };
  });
  objects.push({
    id: "dictionary-overrides:overrides",
    routeId: "overrides",
    districtId: "dictionaries",
    branchId: "overrides",
    kind: "dictionary-overrides",
    code: "OVR-00",
    name: "全局修正",
    englishName: "GLOBAL OVERRIDES",
    summary: "覆盖基础词典解析结果的人工修正层。",
    status: (library?.override_count ?? 0) > 0 ? "ready" : "neutral",
    statusLabel: "修正层就绪",
    readings: [
      { label: "修正", value: `${library?.override_count ?? 0}` },
      { label: "词典", value: `${installations.length}` },
      { label: "总词条", value: (library?.entry_count ?? 0).toLocaleString("zh-CN") },
    ],
    items: (library?.scan_issues ?? []).map((issue, index) => ({
      id: `issue:${index}`,
      label: issue,
      value: "SCAN",
    })),
    body: null,
    updatedAt: null,
  });
  const branchDefinitions = [
    ["stack", "STK", "优先级词典", "PRIORITY STACK"],
    ["overrides", "OVR", "全局修正", "GLOBAL OVERRIDES"],
  ] as const;
  const branches = branchDefinitions.map<CapabilityBranchRecord>(
    ([id, code, name, englishName]) => {
      const objectIds = objects
        .filter((object) => object.branchId === id)
        .map((object) => object.id);
      return {
        id,
        code,
        name,
        englishName,
        summary: id === "stack" ? "按优先级向深处排列" : "独立修正层",
        count: objectIds.length,
        status: statusFromCount(objectIds.length),
        objectIds,
      };
    },
  );
  return {
    id: "dictionaries",
    code: "DIC",
    index: "C3",
    name: "词典索引",
    englishName: "DICTIONARY FIELD",
    summary: "词典按优先级进入深处，授权与覆盖层保持独立。",
    inventoryLabel: "DICT / ENTRY",
    inventoryValue: `${installations.length} / ${(library?.entry_count ?? 0).toLocaleString("zh-CN")}`,
    status: statusFromCount(installations.length),
    branches,
    objects,
  };
}

function promptObject(
  preset: SystemPreset | TranslationPromptPreset,
  kind: "system-prompt" | "translation-prompt",
  index: number,
): CapabilityObjectRecord {
  const system = kind === "system-prompt";
  return {
    id: `${kind}:${preset.id}`,
    routeId: preset.id,
    districtId: "prompts",
    branchId: system ? "system" : "translation",
    kind,
    code: `${system ? "SYS" : "TRN"}-${String(index + 1).padStart(2, "0")}`,
    name: preset.name,
    englishName: system ? "SYSTEM PROMPT" : "TRANSLATION PROMPT",
    summary: compactText(preset.system_prompt),
    status: "ready",
    statusLabel: "预设可用",
    readings: [
      { label: "字符", value: preset.system_prompt.length.toLocaleString("zh-CN") },
      { label: "类型", value: system ? "SYSTEM" : "TRANSLATION" },
    ],
    items: [],
    body: preset.system_prompt,
    updatedAt: preset.updated_at,
  };
}

function promptDistrict(
  systemPrompts: readonly SystemPreset[],
  translationPrompts: readonly TranslationPromptPreset[],
): CapabilityDistrictRecord {
  const systemObjects = systemPrompts.map((preset, index) =>
    promptObject(preset, "system-prompt", index),
  );
  const translationObjects = translationPrompts.map((preset, index) =>
    promptObject(preset, "translation-prompt", index),
  );
  const objects = [...systemObjects, ...translationObjects];
  const branches: CapabilityBranchRecord[] = [
    {
      id: "system",
      code: "SYS",
      name: "系统预设",
      englishName: "SYSTEM PROMPTS",
      summary: "描述与分析任务的系统协议",
      count: systemObjects.length,
      status: statusFromCount(systemObjects.length),
      objectIds: systemObjects.map((object) => object.id),
    },
    {
      id: "translation",
      code: "TRN",
      name: "翻译预设",
      englishName: "TRANSLATION PROMPTS",
      summary: "翻译任务的专用协议",
      count: translationObjects.length,
      status: statusFromCount(translationObjects.length),
      objectIds: translationObjects.map((object) => object.id),
    },
  ];
  return {
    id: "prompts",
    code: "PRM",
    index: "D4",
    name: "协议档案",
    englishName: "PROMPT ARCHIVE",
    summary: "System 与 Translation Prompt 沿两条档案带展开。",
    inventoryLabel: "SYSTEM / TRANS",
    inventoryValue: `${systemObjects.length} / ${translationObjects.length}`,
    status: statusFromCount(objects.length),
    branches,
    objects,
  };
}

export function createCapabilityDistricts(
  input: CapabilityInventoryInput,
): readonly CapabilityDistrictRecord[] {
  return [
    providerDistrict(input.providers),
    taggerDistrict(input.taggers),
    dictionaryDistrict(input.dictionaries),
    promptDistrict(input.systemPrompts, input.translationPrompts),
  ];
}

export function findCapabilityObject(
  districts: readonly CapabilityDistrictRecord[],
  selection: CapabilityRouteSelection,
): CapabilityObjectRecord | null {
  if (!selection.districtId || !selection.kind || !selection.routeId) return null;
  const district = districts.find((candidate) => candidate.id === selection.districtId);
  return (
    district?.objects.find(
      (object) => object.kind === selection.kind && object.routeId === selection.routeId,
    ) ?? null
  );
}

export function isCapabilityDistrictId(value: string): value is CapabilityDistrictId {
  return ["providers", "taggers", "dictionaries", "prompts"].includes(value);
}

export function capabilityObjectPath(object: CapabilityObjectRecord): string {
  const routeId = encodeURIComponent(object.routeId);
  if (object.kind === "provider") return `/capability/providers/profile/${routeId}`;
  if (object.kind === "tagger-runtime") return "/capability/taggers/runtime";
  if (object.kind === "tagger-installation") return `/capability/taggers/installation/${routeId}`;
  if (object.kind === "tagger-profile") return `/capability/taggers/profile/${routeId}`;
  if (object.kind === "dictionary") return `/capability/dictionaries/installation/${routeId}`;
  if (object.kind === "dictionary-overrides") return "/capability/dictionaries/overrides";
  if (object.kind === "system-prompt") return `/capability/prompts/system/${routeId}`;
  return `/capability/prompts/translation/${routeId}`;
}

export function parseCapabilityPath(pathname: string): CapabilityRouteSelection {
  const segments = pathname
    .replace(/^\/capability\/?/u, "")
    .split("/")
    .filter(Boolean)
    .map((segment) => {
      try {
        return decodeURIComponent(segment);
      } catch {
        return segment;
      }
    });
  const districtId = segments[0];
  if (!districtId || !isCapabilityDistrictId(districtId)) {
    return { districtId: null, kind: null, routeId: null };
  }
  const category = segments[1];
  const routeId = segments[2] ?? null;
  if (districtId === "providers" && category === "new") {
    return { districtId, kind: "provider", routeId: "new" };
  }
  if (districtId === "providers" && category === "profile" && routeId) {
    return { districtId, kind: "provider", routeId };
  }
  if (districtId === "taggers") {
    if (category === "runtime") return { districtId, kind: "tagger-runtime", routeId: "runtime" };
    if (category === "installation" && routeId) {
      return { districtId, kind: "tagger-installation", routeId };
    }
    if (category === "profile" && routeId) return { districtId, kind: "tagger-profile", routeId };
  }
  if (districtId === "dictionaries") {
    if (category === "installation" && routeId) {
      return { districtId, kind: "dictionary", routeId };
    }
    if (category === "overrides") {
      return { districtId, kind: "dictionary-overrides", routeId: "overrides" };
    }
  }
  if (districtId === "prompts") {
    if (category === "system" && routeId) return { districtId, kind: "system-prompt", routeId };
    if (category === "translation" && routeId) {
      return { districtId, kind: "translation-prompt", routeId };
    }
  }
  return { districtId, kind: null, routeId: null };
}
