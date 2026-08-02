import { describe, expect, test } from "vitest";

import {
  DEFAULT_FRONTEND_THEME_ID,
  FRONTEND_THEME_IDS,
  getFrontendTheme,
  resolveFrontendThemeId,
} from "./themeRegistry";

describe("new frontend theme registry", () => {
  test("discovers complete theme packages without a central visual manifest", () => {
    expect(FRONTEND_THEME_IDS).toContain("dial-archive");
    expect(new Set(FRONTEND_THEME_IDS).size).toBe(FRONTEND_THEME_IDS.length);
    expect(getFrontendTheme("dial-archive").id).toBe("dial-archive");
  });

  test("uses the canonical theme parameter and keeps the old home parameter compatible", () => {
    expect(resolveFrontendThemeId("?theme=dial-archive")).toBe("dial-archive");
    expect(resolveFrontendThemeId("?home=dial-archive")).toBe("dial-archive");
    expect(resolveFrontendThemeId("?theme=unknown")).toBe(DEFAULT_FRONTEND_THEME_ID);
    expect(resolveFrontendThemeId("")).toBe(DEFAULT_FRONTEND_THEME_ID);
  });
});
