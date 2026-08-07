import { describe, expect, test } from "vitest";

import type { ProviderProfile, SystemPreset, TaggerLibrary } from "../../../../shared/api/types";
import {
  CAPABILITY_LIBRARY_CATEGORY_DEFINITIONS,
  CAPABILITY_LIBRARY_GROUP_DEFINITIONS,
  createCapabilityLibraryOverview,
  isCapabilityLibraryCategoryId,
  type CapabilityLibraryOverviewInput,
} from "./capabilityLibraryModel";

function input(
  overrides: Partial<CapabilityLibraryOverviewInput> = {},
): CapabilityLibraryOverviewInput {
  return {
    providers: [],
    taggers: null,
    dictionaries: null,
    systemPrompts: [],
    translationPrompts: [],
    diagnostics: null,
    hasUnreadAnnouncement: false,
    sources: {
      providers: "ready",
      taggers: "ready",
      dictionaries: "ready",
      systemPrompts: "ready",
      translationPrompts: "ready",
      diagnostics: "ready",
    },
    ...overrides,
  };
}

describe("capability library overview model", () => {
  test("recognizes only the five semantic category route ids", () => {
    expect(isCapabilityLibraryCategoryId("providers")).toBe(true);
    expect(isCapabilityLibraryCategoryId("system")).toBe(true);
    expect(isCapabilityLibraryCategoryId("legacy-settings")).toBe(false);
    expect(isCapabilityLibraryCategoryId(null)).toBe(false);
  });

  test("keeps the four production categories ahead of subordinate Studio control", () => {
    expect(
      CAPABILITY_LIBRARY_CATEGORY_DEFINITIONS.map(({ id, code, lane }) => ({ id, code, lane })),
    ).toEqual([
      { id: "providers", code: "PVD", lane: "primary" },
      { id: "taggers", code: "TAG", lane: "primary" },
      { id: "dictionaries", code: "DIC", lane: "primary" },
      { id: "prompts", code: "PRM", lane: "primary" },
      { id: "system", code: "SYS", lane: "system" },
    ]);
  });

  test("keeps dense settings in category-specific function lanes", () => {
    expect(CAPABILITY_LIBRARY_GROUP_DEFINITIONS.taggers.map((group) => group.id)).toEqual([
      "profiles",
      "installations",
      "runtime",
      "downloads",
    ]);
    expect(CAPABILITY_LIBRARY_GROUP_DEFINITIONS.dictionaries.map((group) => group.id)).toEqual([
      "installations",
      "overrides",
      "downloads",
    ]);
    expect(CAPABILITY_LIBRARY_GROUP_DEFINITIONS.prompts.map((group) => group.id)).toEqual([
      "system",
      "translation",
    ]);
  });

  test("separates Tagger installations from per-model execution profiles", () => {
    const taggers = {
      model_root: "D:/models/taggers",
      disk_size: 4096,
      runtime: { available: true, devices: ["cuda"], providers: ["onnxruntime"] },
      scan_issues: [],
      supported_adapters: [],
      installations: [
        {
          id: "installation-1",
          name: "WD Tagger",
          adapter_id: "wd14",
          adapter_name: "WD 1.4",
          adapter_contract_version: 1,
          model_version: "v3",
          tag_count: 12_000,
          disk_size: 4096,
          status: "ready",
          updated_at: "2026-08-07T00:00:00Z",
          categories: { general: 8_000, character: 4_000 },
          profile_capabilities: {
            supported_selection_modes: ["global", "category"],
            default_categories: ["general", "character"],
            default_selection: {
              mode: "category",
              global_threshold: 0.35,
              category_thresholds: { character: 0.7 },
              max_tags: 80,
            },
          },
        },
      ],
      profiles: [
        {
          id: "profile-1",
          name: "角色模型高精度",
          installation_id: "installation-1",
          installation_name: "WD Tagger",
          model_version: "v3",
          ready: true,
          selection: {
            mode: "category",
            global_threshold: 0.35,
            category_thresholds: { character: 0.7 },
            max_tags: 80,
          },
          categories: ["general", "character"],
          device: "cuda",
          batch_size: 8,
          updated_at: "2026-08-07T00:00:00Z",
        },
      ],
    } as unknown as TaggerLibrary;

    const overview = createCapabilityLibraryOverview(input({ taggers }));
    const category = overview.categories.find((item) => item.id === "taggers")!;
    const profile = category.inventory.find((item) => item.groupId === "profiles")!;
    const installation = category.inventory.find((item) => item.groupId === "installations")!;

    expect(category.defaultGroupId).toBe("profiles");
    expect(profile).toMatchObject({
      routeId: "profile-1",
      label: "角色模型高精度",
      workbenchPath: "/capability/taggers/profile/profile-1",
      actionLabel: "编辑模型执行参数",
    });
    expect(profile.facts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: "SELECTION", value: "CATEGORY" }),
        expect.objectContaining({ label: "DEVICE", value: "CUDA" }),
        expect.objectContaining({ label: "BATCH", value: "8" }),
      ]),
    );
    expect(installation.workbenchPath).toBe("/capability/taggers/installation/installation-1");
  });

  test("projects real provider inventory into the PVD summary", () => {
    const provider = {
      id: "provider-1",
      name: "Studio Provider",
      provider_type: "openai_compatible",
      base_url: "https://example.invalid/v1",
      default_model_id: "model-a",
      models: [
        {
          model_id: "model-a",
          max_output_tokens: 4096,
          temperature: 0.2,
          timeout_seconds: 180,
          protocol_options: { provider_type: "openai_compatible", reasoning_effort: null },
        },
        {
          model_id: "model-b",
          max_output_tokens: 4096,
          temperature: 0.2,
          timeout_seconds: 180,
          protocol_options: { provider_type: "openai_compatible", reasoning_effort: null },
        },
      ],
      concurrency: 4,
      has_api_key: true,
      created_at: "2026-08-07T00:00:00Z",
      updated_at: "2026-08-07T00:00:00Z",
    } as ProviderProfile;

    const overview = createCapabilityLibraryOverview(input({ providers: [provider] }));
    const providers = overview.categories[0];

    expect(overview.status).toBe("ready");
    expect(providers.id).toBe("providers");
    expect(providers.state).toBe("ready");
    expect(providers.headlineValue).toBe("2");
    expect(providers.inventory[0]).toMatchObject({
      label: "Studio Provider",
      detail: "OPENAI_COMPATIBLE // model-a",
      kindLabel: "PROVIDER PROFILE",
      tags: ["model-a", "model-b"],
    });
    expect(providers.inventory[0].facts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: "DEFAULT", value: "model-a" }),
        expect.objectContaining({ label: "CREDENTIAL", value: "SEALED" }),
      ]),
    );
  });

  test("keeps the full register while prompt resources expose metadata rather than body text", () => {
    const providers = Array.from(
      { length: 7 },
      (_, index) =>
        ({
          id: `provider-${index}`,
          name: `Provider ${index}`,
          provider_type: "codex",
          base_url: "https://example.invalid/v1",
          default_model_id: "gpt-model",
          models: [],
          concurrency: 1,
          has_api_key: true,
          created_at: "2026-08-07T00:00:00Z",
          updated_at: "2026-08-07T00:00:00Z",
        }) as ProviderProfile,
    );
    const prompt = {
      id: "prompt-1",
      name: "Private protocol",
      system_prompt: "SECRET BODY MUST NOT ENTER THE REGISTER",
      created_at: "2026-08-01T00:00:00Z",
      updated_at: "2026-08-07T00:00:00Z",
    } as SystemPreset;
    const overview = createCapabilityLibraryOverview(input({ providers, systemPrompts: [prompt] }));

    expect(
      overview.categories.find((category) => category.id === "providers")?.inventory,
    ).toHaveLength(7);
    const promptResource = overview.categories.find((category) => category.id === "prompts")
      ?.inventory[0];
    expect(promptResource?.id).toBe("system-prompt-1");
    expect(JSON.stringify(promptResource)).not.toContain(prompt.system_prompt);
  });

  test("keeps partial source failures visible without removing healthy categories", () => {
    const overview = createCapabilityLibraryOverview(
      input({
        sources: {
          providers: "ready",
          taggers: "error",
          dictionaries: "ready",
          systemPrompts: "ready",
          translationPrompts: "ready",
          diagnostics: "ready",
        },
        errors: ["Tagger index unavailable"],
      }),
    );

    expect(overview.status).toBe("partial-error");
    expect(overview.message).toBe("Tagger index unavailable");
    expect(overview.categories.find((category) => category.id === "taggers")?.state).toBe("error");
    expect(overview.categories.find((category) => category.id === "providers")?.state).toBe(
      "attention",
    );
  });
});
