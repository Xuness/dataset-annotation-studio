import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { AppearanceSettings } from "../../shared/settings/sections/AppearanceSettings";
import { applyPreferences } from "../../shared/theme/appearanceRuntime";
import { useAppPreferences } from "../../shared/theme/appPreferences";
import { createDefaultPreferences, DEFAULT_HOME_CONTENT } from "../../shared/theme/appearance";

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

  test("stores scene visibility independently for each theme", async () => {
    const user = userEvent.setup();
    render(<AppearanceSettings onClose={() => undefined} />);

    fireEvent.change(screen.getByRole("slider", { name: "首页背景可见度" }), {
      target: { value: "47" },
    });
    expect(
      useAppPreferences.getState().preferences.appearance.sceneOverrides["sea-fog"]?.home.opacity,
    ).toBe(0.47);

    await user.click(screen.getByRole("button", { name: /暖纸手札/ }));
    expect((screen.getByRole("slider", { name: "首页背景可见度" }) as HTMLInputElement).value).toBe(
      "65",
    );
    fireEvent.change(screen.getByRole("slider", { name: "首页背景可见度" }), {
      target: { value: "64" },
    });

    await user.click(screen.getByRole("button", { name: /雨白哥特/ }));
    expect((screen.getByRole("slider", { name: "首页背景可见度" }) as HTMLInputElement).value).toBe(
      "47",
    );
    expect(
      useAppPreferences.getState().preferences.appearance.sceneOverrides["warm-paper"]?.home
        .opacity,
    ).toBe(0.64);

    await user.click(screen.getAllByRole("button", { name: "重置" })[0]);
    expect((screen.getByRole("slider", { name: "首页背景可见度" }) as HTMLInputElement).value).toBe(
      "85",
    );
    expect(
      useAppPreferences.getState().preferences.appearance.sceneOverrides["sea-fog"],
    ).toBeUndefined();
    expect(
      useAppPreferences.getState().preferences.appearance.sceneOverrides["warm-paper"]?.home
        .opacity,
    ).toBe(0.64);
    expect(
      JSON.parse(window.localStorage.getItem("dataset-studio.preferences") ?? "null").appearance
        .sceneOverrides["warm-paper"].home.opacity,
    ).toBe(0.64);
  });

  test("toggles the default immersive mode through the rendered controls", async () => {
    const user = userEvent.setup();
    render(<AppearanceSettings onClose={() => undefined} />);

    expect(useAppPreferences.getState().preferences.appearance.immersiveMode).toBe(true);
    await user.click(screen.getByRole("button", { name: /让工作台完全沉入场景/ }));

    expect(useAppPreferences.getState().preferences.appearance.immersiveMode).toBe(false);
    expect(screen.getByRole("button", { name: /图片画布/ }).getAttribute("aria-pressed")).toBe(
      "false",
    );
  });

  test("saves empty homepage copy and restores defaults", async () => {
    const user = userEvent.setup();
    render(<AppearanceSettings onClose={() => undefined} />);

    const headline = screen.getByRole("textbox", { name: /首页主标题/ });
    const description = screen.getByRole("textbox", { name: /首页说明文字/ });
    await user.clear(headline);
    await user.clear(description);
    await user.click(screen.getByRole("button", { name: /保存文案/ }));

    expect(useAppPreferences.getState().preferences.homeContent).toEqual({
      headline: "",
      description: "",
    });
    expect(
      JSON.parse(window.localStorage.getItem("dataset-studio.preferences") ?? "null").homeContent,
    ).toEqual(useAppPreferences.getState().preferences.homeContent);

    await user.click(screen.getByRole("button", { name: /恢复默认/ }));
    expect(useAppPreferences.getState().preferences.homeContent).toEqual(DEFAULT_HOME_CONTENT);
  });
});
