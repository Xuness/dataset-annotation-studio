import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { FrontendFirstUseDialog } from "./FrontendFirstUseDialog";
import {
  FRONTEND_FIRST_USE_CHOICE_KEY,
  FRONTEND_FIRST_USE_SEEN_KEY,
} from "./frontendFirstUseState";

describe("new theme first-use dialog", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  afterEach(() => {
    cleanup();
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  test("offers classic, V2, and dismiss choices on the first visit", () => {
    render(<FrontendFirstUseDialog />);

    expect(screen.getByRole("dialog").getAttribute("aria-modal")).toBe("true");
    expect(window.localStorage.getItem(FRONTEND_FIRST_USE_SEEN_KEY)).toBe("1");
    expect(screen.getByRole("heading", { name: "第一次使用新版主题吗？" })).toBeTruthy();
    expect(screen.getByRole("link", { name: /先去旧版熟悉/u }).getAttribute("href")).toBe(
      "/legacy.html",
    );
    expect(screen.getByRole("button", { name: /直接使用新版/u })).toBeTruthy();
    expect(screen.getByRole("button", { name: /不再重复提醒/u })).toBeTruthy();
  });

  test("appears only on the first entry even when no choice is made", () => {
    const first = render(<FrontendFirstUseDialog />);
    first.unmount();

    render(<FrontendFirstUseDialog />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  test("remembers a decision to continue in V2 across later mounts", () => {
    const first = render(<FrontendFirstUseDialog />);
    fireEvent.click(screen.getByRole("button", { name: /直接使用新版/u }));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(window.localStorage.getItem(FRONTEND_FIRST_USE_CHOICE_KEY)).toBe("continue");
    first.unmount();

    render(<FrontendFirstUseDialog />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  test("records the classic-theme route before following its link", () => {
    render(<FrontendFirstUseDialog />);
    const classic = screen.getByRole("link", { name: /先去旧版熟悉/u });
    classic.addEventListener("click", (event) => event.preventDefault());
    fireEvent.click(classic);

    expect(window.localStorage.getItem(FRONTEND_FIRST_USE_CHOICE_KEY)).toBe("legacy");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  test("dismisses permanently without recording a theme choice", () => {
    const first = render(<FrontendFirstUseDialog />);
    fireEvent.click(screen.getByRole("button", { name: /不再重复提醒/u }));

    expect(window.localStorage.getItem(FRONTEND_FIRST_USE_CHOICE_KEY)).toBeNull();
    expect(window.localStorage.getItem(FRONTEND_FIRST_USE_SEEN_KEY)).toBe("1");
    first.unmount();

    window.sessionStorage.clear();
    const laterVisit = render(<FrontendFirstUseDialog />);
    expect(screen.queryByRole("dialog")).toBeNull();
    laterVisit.unmount();
  });

  test("treats Escape as a permanent dismissal", () => {
    render(<FrontendFirstUseDialog />);
    fireEvent.keyDown(window, { key: "Escape" });

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(window.localStorage.getItem(FRONTEND_FIRST_USE_SEEN_KEY)).toBe("1");
  });
});
