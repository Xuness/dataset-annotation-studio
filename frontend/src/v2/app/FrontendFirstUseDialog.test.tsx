import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { FrontendFirstUseDialog } from "./FrontendFirstUseDialog";
import {
  FRONTEND_FIRST_USE_CHOICE_KEY,
  FRONTEND_FIRST_USE_DEFERRED_KEY,
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

  test("offers classic, V2, and remind-later choices on the first visit", () => {
    render(<FrontendFirstUseDialog />);

    expect(screen.getByRole("dialog").getAttribute("aria-modal")).toBe("true");
    expect(screen.getByRole("heading", { name: "第一次使用新版主题吗？" })).toBeTruthy();
    expect(screen.getByRole("link", { name: /先去旧版熟悉/u }).getAttribute("href")).toBe(
      "/legacy.html",
    );
    expect(screen.getByRole("button", { name: /直接使用新版/u })).toBeTruthy();
    expect(screen.getByRole("button", { name: /稍后再提醒/u })).toBeTruthy();
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

  test("defers only for the current session and returns after a new session", () => {
    const first = render(<FrontendFirstUseDialog />);
    fireEvent.click(screen.getByRole("button", { name: /稍后再提醒/u }));

    expect(window.localStorage.getItem(FRONTEND_FIRST_USE_CHOICE_KEY)).toBeNull();
    expect(window.sessionStorage.getItem(FRONTEND_FIRST_USE_DEFERRED_KEY)).toBe("1");
    first.unmount();

    const sameSession = render(<FrontendFirstUseDialog />);
    expect(screen.queryByRole("dialog")).toBeNull();
    sameSession.unmount();

    window.sessionStorage.clear();
    render(<FrontendFirstUseDialog />);
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  test("treats Escape as remind later", () => {
    render(<FrontendFirstUseDialog />);
    fireEvent.keyDown(window, { key: "Escape" });

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(window.sessionStorage.getItem(FRONTEND_FIRST_USE_DEFERRED_KEY)).toBe("1");
  });
});
