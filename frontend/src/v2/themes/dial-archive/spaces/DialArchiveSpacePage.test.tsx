import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { getHomeSpace } from "../../../navigation/spaceRegistry";
import type { ArchiveSpaceContent } from "../../../pages/spaces/spacePageModel";
import { DialArchiveSpacePage } from "./DialArchiveSpacePage";

const originalMatchMedia = Object.getOwnPropertyDescriptor(window, "matchMedia");
const originalAnimate = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "animate");

function archiveContent(overrides: Partial<ArchiveSpaceContent> = {}): ArchiveSpaceContent {
  return {
    kind: "archive",
    status: "ready",
    activeProjectId: "project-1",
    message: null,
    registering: false,
    removingProjectId: null,
    projects: [
      {
        id: "project-1",
        name: "Portrait Set",
        rootPath: "D:\\datasets\\portraits",
        exists: true,
        assetCount: 42,
        annotatedCount: 24,
        invalidCount: 0,
        createdAt: "2026-08-01T00:00:00Z",
        lastOpenedAt: "2026-08-02T00:00:00Z",
      },
      {
        id: "project-2",
        name: "Landscape Set",
        rootPath: "D:\\datasets\\landscapes",
        exists: true,
        assetCount: 18,
        annotatedCount: 4,
        invalidCount: 1,
        createdAt: "2026-08-01T00:00:00Z",
        lastOpenedAt: null,
      },
    ],
    registerProject: vi.fn().mockResolvedValue(null),
    loadProject: vi.fn(),
    openProjectWorkbench: vi.fn(),
    revealProject: vi.fn().mockResolvedValue(undefined),
    removeProject: vi.fn().mockResolvedValue(undefined),
    clearMessage: vi.fn(),
    ...overrides,
  };
}

describe("dial archive space page", () => {
  beforeEach(() => {
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
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    if (originalMatchMedia) Object.defineProperty(window, "matchMedia", originalMatchMedia);
    else Reflect.deleteProperty(window, "matchMedia");
    if (originalAnimate) Object.defineProperty(HTMLElement.prototype, "animate", originalAnimate);
    else Reflect.deleteProperty(HTMLElement.prototype, "animate");
  });

  test("renders actual registered workspaces one at a time", () => {
    render(
      <DialArchiveSpacePage
        space={getHomeSpace("archive")}
        content={archiveContent()}
        onNavigateSpace={vi.fn()}
        onReturnHome={vi.fn()}
      />,
    );

    expect(screen.getByRole("heading", { name: "项目档案" })).toBeTruthy();
    expect(screen.getAllByText("Portrait Set").length).toBeGreaterThan(0);
    expect(screen.queryByText(/Replaced-/u)).toBeNull();
    expect(screen.getByText("REGISTERED").parentElement?.textContent).toContain("2");

    fireEvent.click(screen.getByRole("button", { name: "下一个项目" }));
    expect(screen.getAllByText("Landscape Set").length).toBeGreaterThan(0);
    expect(screen.getAllByText("CHECK · 1").length).toBeGreaterThan(0);
  });

  test("wires project context and safe local actions through the neutral controller contract", async () => {
    const content = archiveContent();
    render(
      <DialArchiveSpacePage
        space={getHomeSpace("archive")}
        content={content}
        onNavigateSpace={vi.fn()}
        onReturnHome={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /展开项目档案/u }));
    const workbenchButton = screen.getByRole("button", { name: /进入项目工作间/u });
    expect(workbenchButton.hasAttribute("disabled")).toBe(false);
    expect(screen.getByRole("button", { name: /已装载为当前项目/u }).hasAttribute("disabled")).toBe(
      true,
    );

    fireEvent.click(workbenchButton);
    expect(content.openProjectWorkbench).toHaveBeenCalledWith("project-1");

    fireEvent.click(screen.getByRole("button", { name: /在文件管理器中打开/u }));
    await waitFor(() => expect(content.revealProject).toHaveBeenCalledWith("project-1"));

    fireEvent.click(screen.getByRole("button", { name: /移除项目登记 REMOVE/u }));
    fireEvent.click(screen.getByRole("button", { name: /确认移除项目登记/u }));
    await waitFor(() => expect(content.removeProject).toHaveBeenCalledWith("project-1"));
  });

  test("hands semantic space and home intents back to the neutral router", () => {
    const onNavigateSpace = vi.fn();
    const onReturnHome = vi.fn();
    render(
      <DialArchiveSpacePage
        space={getHomeSpace("archive")}
        content={archiveContent()}
        onNavigateSpace={onNavigateSpace}
        onReturnHome={onReturnHome}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "进入空间 04 质量控制" }));
    expect(onNavigateSpace).toHaveBeenCalledWith("quality");
    fireEvent.click(screen.getByRole("button", { name: /HOME/u }));
    expect(onReturnHome).toHaveBeenCalledWith("archive");
  });

  test("cancels stale route commits and keeps only the latest rapid intent", () => {
    vi.useFakeTimers();
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: () =>
        ({
          matches: false,
          media: "(prefers-reduced-motion: reduce)",
          onchange: null,
          addEventListener() {},
          removeEventListener() {},
          addListener() {},
          removeListener() {},
          dispatchEvent: () => false,
        }) satisfies MediaQueryList,
    });
    Object.defineProperty(HTMLElement.prototype, "animate", {
      configurable: true,
      value: vi.fn(
        () =>
          ({
            cancel: vi.fn(),
            finished: Promise.resolve(),
          }) as unknown as Animation,
      ),
    });
    const onNavigateSpace = vi.fn();
    render(
      <DialArchiveSpacePage
        space={getHomeSpace("archive")}
        content={archiveContent()}
        onNavigateSpace={onNavigateSpace}
        onReturnHome={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "进入空间 04 质量控制" }));
    fireEvent.click(screen.getByRole("button", { name: "进入空间 05 发布交付" }));
    act(() => vi.advanceTimersByTime(190));

    expect(onNavigateSpace).toHaveBeenCalledTimes(1);
    expect(onNavigateSpace).toHaveBeenCalledWith("delivery");
  });
});
