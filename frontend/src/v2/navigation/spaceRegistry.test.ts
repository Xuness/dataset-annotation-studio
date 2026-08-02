import { describe, expect, test } from "vitest";

import {
  getAdjacentHomeSpace,
  getHomeSpaceByRoute,
  HOME_SPACES,
  PRIMARY_HOME_SPACES,
  SUPPORT_HOME_SPACES,
} from "./spaceRegistry";

describe("new frontend home space registry", () => {
  test("keeps six unique first-level destinations in the agreed lanes", () => {
    expect(HOME_SPACES).toHaveLength(6);
    expect(new Set(HOME_SPACES.map((space) => space.id)).size).toBe(6);
    expect(PRIMARY_HOME_SPACES).toHaveLength(4);
    expect(SUPPORT_HOME_SPACES).toHaveLength(2);
    expect(HOME_SPACES.every((space) => space.route.startsWith("/"))).toBe(true);
  });

  test("wraps keyboard navigation across both rails", () => {
    expect(getAdjacentHomeSpace("archive", -1)).toBe("capability");
    expect(getAdjacentHomeSpace("capability", 1)).toBe("archive");
    expect(getAdjacentHomeSpace("annotation", 1)).toBe("quality");
  });

  test("resolves stable product routes without theme knowledge", () => {
    expect(getHomeSpaceByRoute("/archive")?.id).toBe("archive");
    expect(getHomeSpaceByRoute("/missing")).toBeNull();
  });
});
