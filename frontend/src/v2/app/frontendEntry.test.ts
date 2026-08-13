import { describe, expect, test } from "vitest";

import { shouldLoadNewFrontend } from "./frontendEntry";

describe("frontend product entry", () => {
  test("uses the classic interface for ordinary startup", () => {
    expect(shouldLoadNewFrontend("")).toBe(false);
    expect(shouldLoadNewFrontend("?project=project-1")).toBe(false);
  });

  test("loads the new interface only when a theme entry is explicit", () => {
    expect(shouldLoadNewFrontend("?theme=dial-archive")).toBe(true);
    expect(shouldLoadNewFrontend("?home=dial-archive")).toBe(true);
    expect(shouldLoadNewFrontend("?theme=unknown")).toBe(true);
  });
});
