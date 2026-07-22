import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { AppearanceSettings } from "../../src/shared/settings/sections/AppearanceSettings";
import { applyPreferences } from "../../src/shared/theme/appearanceRuntime";
import { useAppPreferences } from "../../src/shared/theme/appPreferences";
import { createDefaultPreferences } from "../../src/shared/theme/appearance";

function resetAppearance() {
  const preferences = createDefaultPreferences();
  window.localStorage.clear();
  useAppPreferences.setState({ preferences });
  applyPreferences(preferences);
}

describe("appearance settings", () => {
  beforeEach(resetAppearance);
  afterEach(cleanup);

  test("switches themes and stores the selection", async () => {
    const user = userEvent.setup();
    render(<AppearanceSettings onClose={() => undefined} />);

    await user.click(screen.getByRole("button", { name: /暖纸手札/ }));

    expect(useAppPreferences.getState().preferences.themeId).toBe("warm-paper");
  });

  test("updates scene visibility and immersive mode through the rendered controls", async () => {
    const user = userEvent.setup();
    render(<AppearanceSettings onClose={() => undefined} />);

    fireEvent.change(screen.getByRole("slider", { name: "首页背景可见度" }), {
      target: { value: "47" },
    });
    expect(useAppPreferences.getState().preferences.appearance.home.opacity).toBe(0.47);

    await user.click(screen.getByRole("button", { name: /让工作台完全沉入场景/ }));

    expect(useAppPreferences.getState().preferences.appearance.immersiveMode).toBe(true);
    expect(screen.getByRole("button", { name: /图片画布/ }).getAttribute("aria-pressed")).toBe(
      "true",
    );
  });
});
