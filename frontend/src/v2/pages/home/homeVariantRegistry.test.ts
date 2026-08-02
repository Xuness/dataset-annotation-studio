import { describe, expect, test } from "vitest";

import {
  DEFAULT_HOME_VARIANT_ID,
  getHomeVariant,
  HOME_VARIANT_IDS,
  resolveHomeVariantId,
} from "./homeVariantRegistry";

describe("new frontend home variant registry", () => {
  test("discovers each isolated variant directory without a shared manifest edit", () => {
    expect(HOME_VARIANT_IDS).toContain("dial-archive");
    expect(new Set(HOME_VARIANT_IDS).size).toBe(HOME_VARIANT_IDS.length);
    expect(getHomeVariant("dial-archive").id).toBe("dial-archive");
  });

  test("selects a known query variant and safely falls back for unknown IDs", () => {
    expect(resolveHomeVariantId("?home=dial-archive")).toBe("dial-archive");
    expect(resolveHomeVariantId("?home=unregistered-model-output")).toBe(DEFAULT_HOME_VARIANT_ID);
    expect(resolveHomeVariantId("")).toBe(DEFAULT_HOME_VARIANT_ID);
  });
});
