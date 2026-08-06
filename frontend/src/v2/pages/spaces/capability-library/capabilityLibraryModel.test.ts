import { describe, expect, test } from "vitest";

import type { ProviderProfile } from "../../../../shared/api/types";
import {
  CAPABILITY_LIBRARY_CATEGORY_DEFINITIONS,
  createCapabilityLibraryOverview,
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
    });
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
