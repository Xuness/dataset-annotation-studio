import { describe, expect, test } from "vitest";

import type {
  ProviderProfile,
  TagDictionaryLibrary,
  TaggerLibrary,
} from "../../../../shared/api/types";
import {
  capabilityObjectPath,
  createCapabilityDistricts,
  findCapabilityObject,
  parseCapabilityPath,
} from "./capabilitySpaceModel";

const provider: ProviderProfile = {
  id: "provider-1",
  name: "OpenRouter 主通道",
  provider_type: "openrouter",
  base_url: "https://openrouter.ai/api/v1",
  default_model_id: "model-a",
  models: [
    {
      model_id: "model-a",
      max_output_tokens: 4096,
      protocol_options: {
        provider_type: "openrouter",
        reasoning_effort: null,
        service_tier: null,
        prompt_cache_strategy: null,
      },
      seed: null,
      temperature: 0.2,
      timeout_seconds: 180,
      top_p: null,
    },
  ],
  concurrency: 4,
  has_api_key: true,
  created_at: "2026-08-01T00:00:00Z",
  updated_at: "2026-08-06T00:00:00Z",
};

const taggers: TaggerLibrary = {
  model_root: "D:/models",
  disk_size: 0,
  installations: [],
  profiles: [],
  runtime: {
    available: true,
    devices: ["cuda"],
    providers: ["onnxruntime"],
    error: null,
  },
  scan_issues: [],
  supported_adapters: [],
};

const dictionaries: TagDictionaryLibrary = {
  dictionary_root: "D:/dicts",
  disk_size: 0,
  entry_count: 0,
  installations: [],
  override_count: 2,
  scan_issues: [],
  supported_adapters: [],
};

describe("capability space model", () => {
  test("projects global inventories into four distinct districts", () => {
    const districts = createCapabilityDistricts({
      providers: [provider],
      taggers,
      dictionaries,
      systemPrompts: [
        {
          id: "system-1",
          name: "描述协议",
          system_prompt: "Describe the image.",
          created_at: "2026-08-01T00:00:00Z",
          updated_at: "2026-08-06T00:00:00Z",
        },
      ],
      translationPrompts: [],
    });

    expect(districts.map((district) => district.id)).toEqual([
      "providers",
      "taggers",
      "dictionaries",
      "prompts",
    ]);
    expect(districts.find((district) => district.id === "providers")?.branches).toHaveLength(5);
    expect(
      districts.find((district) => district.id === "taggers")?.branches.map(({ id }) => id),
    ).toEqual(["runtime", "installations", "profiles"]);
    expect(districts.find((district) => district.id === "dictionaries")?.objects[0].kind).toBe(
      "dictionary-overrides",
    );
  });

  test("keeps semantic object routes reversible", () => {
    const districts = createCapabilityDistricts({
      providers: [provider],
      taggers,
      dictionaries,
      systemPrompts: [],
      translationPrompts: [],
    });
    const object = districts[0].objects[0];
    const path = capabilityObjectPath(object);
    const selection = parseCapabilityPath(path);

    expect(path).toBe("/capability/providers/profile/provider-1");
    expect(selection).toEqual({
      districtId: "providers",
      kind: "provider",
      routeId: "provider-1",
    });
    expect(findCapabilityObject(districts, selection)?.id).toBe(object.id);
  });

  test("treats district-only paths as a third-level camera selection", () => {
    expect(parseCapabilityPath("/capability/providers/new")).toEqual({
      districtId: "providers",
      kind: "provider",
      routeId: "new",
    });
    expect(parseCapabilityPath("/capability/taggers")).toEqual({
      districtId: "taggers",
      kind: null,
      routeId: null,
    });
    expect(parseCapabilityPath("/capability/unknown")).toEqual({
      districtId: null,
      kind: null,
      routeId: null,
    });
  });
});
