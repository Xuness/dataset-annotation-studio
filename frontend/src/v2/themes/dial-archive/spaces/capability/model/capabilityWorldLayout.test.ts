import { describe, expect, test } from "vitest";

import type {
  CapabilityBranchRecord,
  CapabilityDistrictId,
  CapabilityDistrictRecord,
} from "../../../../../pages/spaces/spacePageModel";
import { createCapabilityWorldLayout } from "./capabilityWorldLayout";

const BRANCHES: Readonly<Record<CapabilityDistrictId, readonly [string, string][]>> = {
  providers: [
    ["openrouter", "RTR"],
    ["openai_compatible", "CMP"],
    ["opencode_go", "OCG"],
    ["gemini", "GEM"],
    ["codex", "CDX"],
  ],
  taggers: [
    ["runtime", "RUN"],
    ["installations", "INS"],
    ["profiles", "PRF"],
  ],
  dictionaries: [
    ["stacks", "STK"],
    ["overrides", "OVR"],
  ],
  prompts: [
    ["system", "SYS"],
    ["translation", "TRN"],
  ],
};

function emptyBranch([id, code]: readonly [string, string]): CapabilityBranchRecord {
  return {
    id,
    code,
    name: code,
    englishName: code,
    summary: "EMPTY",
    count: 0,
    status: "attention",
    objectIds: [],
  };
}

function emptyDistricts(): CapabilityDistrictRecord[] {
  const codes: Record<CapabilityDistrictId, string> = {
    providers: "PVD",
    taggers: "TAG",
    dictionaries: "DIC",
    prompts: "PRM",
  };
  return (Object.keys(BRANCHES) as CapabilityDistrictId[]).map((id, index) => ({
    id,
    code: codes[id],
    index: `A${index + 1}`,
    name: codes[id],
    englishName: codes[id],
    summary: "EMPTY DISTRICT",
    inventoryLabel: "OBJECTS",
    inventoryValue: "0",
    status: "attention",
    branches: BRANCHES[id].map(emptyBranch),
    objects: [],
  }));
}

describe("capability world layout", () => {
  test("keeps all spatial facts in one world model", () => {
    const layout = createCapabilityWorldLayout(emptyDistricts());
    const districtNodes = layout.nodes.filter((node) => node.level === "district");

    expect(districtNodes.map((node) => node.districtId)).toEqual([
      "providers",
      "taggers",
      "dictionaries",
      "prompts",
    ]);
    expect(new Set(districtNodes.map((node) => node.position.x)).size).toBe(4);
    expect(districtNodes.every((node) => node.geometry === "district-plate")).toBe(true);
    expect(Object.keys(layout.districtPoses)).toEqual([
      "providers",
      "taggers",
      "dictionaries",
      "prompts",
    ]);
    expect(layout.evidencePlanes.map((plane) => plane.districtId)).toEqual([
      "providers",
      "taggers",
      "dictionaries",
      "prompts",
    ]);
  });

  test("gives each district a different spatial grammar", () => {
    const layout = createCapabilityWorldLayout(emptyDistricts());
    const branches = layout.nodes.filter((node) => node.level === "branch");
    const providerBranches = branches.filter((node) => node.districtId === "providers");
    const taggerBranches = branches.filter((node) => node.districtId === "taggers");
    const dictionaryBranches = branches.filter((node) => node.districtId === "dictionaries");
    const promptBranches = branches.filter((node) => node.districtId === "prompts");

    expect(new Set(providerBranches.map((node) => node.position.z)).size).toBeGreaterThan(1);
    expect(new Set(taggerBranches.map((node) => node.position.x)).size).toBe(3);
    expect(new Set(taggerBranches.map((node) => node.position.z)).size).toBeGreaterThan(1);
    expect(dictionaryBranches).toHaveLength(2);
    expect(new Set(promptBranches.map((node) => node.position.y)).size).toBe(2);
  });

  test("places every hierarchy route behind its district plate", () => {
    const layout = createCapabilityWorldLayout(emptyDistricts());
    for (const edge of layout.edges) {
      const origin = layout.districtOrigins[edge.districtId];
      expect(edge.points.at(-1)?.z).toBeLessThan(origin.z);
    }
  });

  test("keeps a wide world and one ordered depth spine per district", () => {
    const layout = createCapabilityWorldLayout(emptyDistricts());
    const districtSpines = layout.edges.filter(
      (edge) => edge.kind === "spine" && edge.branchId === null,
    );

    expect(layout.bounds.maxX - layout.bounds.minX).toBeGreaterThan(24_000);
    expect(layout.bounds.maxZ - layout.bounds.minZ).toBeGreaterThan(15_000);
    expect(districtSpines).toHaveLength(4);
    for (const spine of districtSpines) {
      expect(new Set(spine.points.map((point) => point.x)).size).toBe(1);
      expect(
        spine.points.every((point, index) => index === 0 || point.z < spine.points[index - 1].z),
      ).toBe(true);
    }
  });
});
