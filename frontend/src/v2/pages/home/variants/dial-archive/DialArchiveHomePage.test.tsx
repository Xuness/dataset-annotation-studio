import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { DialArchiveHomePage } from "./DialArchiveHomePage";

const originalMatchMedia = Object.getOwnPropertyDescriptor(window, "matchMedia");

function row(name: string): HTMLButtonElement {
  return screen.getByRole("button", { name }) as HTMLButtonElement;
}

describe("dial archive home page", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/?home=dial-archive&s=3");
  });

  afterEach(() => {
    cleanup();
    if (originalMatchMedia) {
      Object.defineProperty(window, "matchMedia", originalMatchMedia);
    } else {
      Reflect.deleteProperty(window, "matchMedia");
    }
  });

  test("renders the approved annotation channel without product data on the home page", () => {
    render(<DialArchiveHomePage />);

    expect(screen.getByRole("heading", { name: "Annotation" })).toBeTruthy();
    expect(screen.getAllByText("标注生产")).toHaveLength(2);
    expect(row("预览并锁定空间 03 标注生产").getAttribute("aria-pressed")).toBe("true");
    expect(screen.queryByText(/最近使用|任务统计/u)).toBeNull();
  });

  test("moves the dial immediately but commits only the final stable pointer preview", async () => {
    render(<DialArchiveHomePage />);
    const dial = screen.getByRole("group", { name: "空间选择断环仪" }).parentElement;

    fireEvent.pointerEnter(row("预览并锁定空间 01 项目档案"));
    expect(dial?.getAttribute("data-display-space")).toBe("archive");
    expect(screen.getByRole("heading", { name: "Annotation" })).toBeTruthy();

    fireEvent.pointerEnter(row("预览并锁定空间 02 数据整备"));
    fireEvent.pointerEnter(row("预览并锁定空间 04 质量控制"));
    expect(screen.getByRole("heading", { name: "Annotation" })).toBeTruthy();

    await waitFor(
      () => expect(screen.getByRole("heading", { name: "Quality Control" })).toBeTruthy(),
      { timeout: 500 },
    );
  });

  test("never lets a moving ring hover target chase itself", () => {
    render(<DialArchiveHomePage />);
    const dial = screen.getByRole("group", { name: "空间选择断环仪" }).parentElement;
    const archiveSegment = screen.getByRole("button", { name: "锁定空间 01 项目档案" });

    fireEvent.pointerEnter(archiveSegment);
    expect(dial?.getAttribute("data-display-space")).toBe("annotation");
    expect(screen.getByRole("heading", { name: "Annotation" })).toBeTruthy();
  });

  test("commits clicks and directional keyboard navigation immediately", () => {
    render(<DialArchiveHomePage />);

    fireEvent.click(row("预览并锁定空间 05 发布交付"));
    expect(screen.getByRole("heading", { name: "Delivery" })).toBeTruthy();
    expect(row("预览并锁定空间 05 发布交付").getAttribute("aria-pressed")).toBe("true");

    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(screen.getByRole("heading", { name: "Capability Library" })).toBeTruthy();
    expect(row("预览并锁定空间 06 能力库").getAttribute("aria-pressed")).toBe("true");
  });

  test("snaps previews and suppresses presentation sweeps when motion is reduced", () => {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: () =>
        ({
          matches: true,
          media: "(prefers-reduced-motion: reduce)",
          onchange: null,
          addEventListener() {},
          removeEventListener() {},
          addListener() {},
          removeListener() {},
          dispatchEvent: () => false,
        }) satisfies MediaQueryList,
    });
    render(<DialArchiveHomePage />);

    fireEvent.pointerEnter(row("预览并锁定空间 01 项目档案"));
    expect(screen.getByRole("heading", { name: "Project Archive" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "进入空间" }));
    expect(screen.queryByRole("status")).toBeNull();
  });
});
