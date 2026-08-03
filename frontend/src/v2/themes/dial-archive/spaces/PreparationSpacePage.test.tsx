import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { getHomeSpace } from "../../../navigation/spaceRegistry";
import type {
  PreparationOperationSummary,
  PreparationSpaceContent,
  PreparationWorkbenchContent,
} from "../../../pages/spaces/spacePageModel";
import { DialArchiveSpacePage } from "./DialArchiveSpacePage";

const originalMatchMedia = Object.getOwnPropertyDescriptor(window, "matchMedia");

function preparationForm(): PreparationWorkbenchContent["form"] {
  return {
    scope: "all",
    resizeEnabled: true,
    maxEdge: 2048,
    allowUpscale: false,
    resizeAlgorithm: "lanczos3",
    convertEnabled: false,
    format: "webp",
    quality: 90,
    effort: 4,
    executionMode: "auto",
    acceleratorId: "",
    concurrencyMode: "auto",
    maxWorkers: 8,
    batchMode: "auto",
    batchSize: 32,
    renameEnabled: false,
    renameTemplate: "image_{index}",
    renameStartIndex: 1,
    renamePadding: 6,
  };
}

function operation(
  overrides: Partial<PreparationOperationSummary> = {},
): PreparationOperationSummary {
  return {
    id: "operation-1",
    status: "completed",
    statusLabel: "已完成",
    stageLabel: "已完成",
    itemCount: 10,
    completedItems: 10,
    progressPercent: 100,
    determinate: true,
    currentRelativePath: null,
    etaSeconds: null,
    createdAt: "2026-08-03T04:00:00Z",
    completedAt: "2026-08-03T04:01:00Z",
    errorMessage: null,
    capabilities: ["geometry", "identity"],
    optionSummary: ["最长边 2048", "重命名 image_{index}"],
    backendLabel: "AUTO ROUTE",
    canRecover: true,
    ...overrides,
  };
}

function spaceContent(overrides: Partial<PreparationSpaceContent> = {}): PreparationSpaceContent {
  const recent = operation();
  return {
    kind: "preparation",
    status: "ready",
    project: {
      id: "project-1",
      name: "Portrait Set",
      rootPath: "D:\\datasets\\portraits",
      exists: true,
      assetCount: 42,
      invalidCount: 0,
    },
    samples: [],
    checkedCount: 3,
    activeOperation: null,
    recentOperation: recent,
    recoverableOperation: recent,
    message: null,
    openArchive: vi.fn(),
    openWorkbench: vi.fn(),
    openOperation: vi.fn(),
    ...overrides,
  };
}

function workbenchContent(
  overrides: Partial<PreparationWorkbenchContent> = {},
): PreparationWorkbenchContent {
  return {
    kind: "preparation-workbench",
    status: "ready",
    project: {
      id: "project-1",
      name: "Portrait Set",
      rootPath: "D:\\datasets\\portraits",
      exists: true,
      assetCount: 42,
      invalidCount: 0,
    },
    samples: [],
    initialFocus: "source",
    form: preparationForm(),
    assetCount: 42,
    checkedCount: 3,
    preview: null,
    previewPending: false,
    executionPlan: null,
    executionPlanPending: false,
    executionPlanError: null,
    backends: [],
    backendsPending: false,
    operations: [],
    activeOperation: null,
    selectedOperation: null,
    workspaceBusy: false,
    error: null,
    confirmation: null,
    updateForm: vi.fn(),
    previewAction: vi.fn().mockResolvedValue(undefined),
    executeAction: vi.fn().mockResolvedValue(undefined),
    selectOperation: vi.fn(),
    undoAction: vi.fn().mockResolvedValue(undefined),
    resolveConfirmation: vi.fn(),
    returnToSpace: vi.fn(),
    openArchive: vi.fn(),
    ...overrides,
  };
}

describe("dial archive preparation pages", () => {
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
    if (originalMatchMedia) Object.defineProperty(window, "matchMedia", originalMatchMedia);
    else Reflect.deleteProperty(window, "matchMedia");
  });

  test("treats the capability deck as semantic workbench entrances", () => {
    const content = spaceContent({ recentOperation: null, recoverableOperation: null });
    render(
      <DialArchiveSpacePage
        space={getHomeSpace("preparation")}
        content={content}
        onNavigateSpace={vi.fn()}
        onReturnHome={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "进入尺寸与几何任务配置" }));
    expect(content.openWorkbench).toHaveBeenCalledWith("geometry");
  });

  test("keeps result and recovery navigation as distinct intents", () => {
    const content = spaceContent();
    render(
      <DialArchiveSpacePage
        space={getHomeSpace("preparation")}
        content={content}
        onNavigateSpace={vi.fn()}
        onReturnHome={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /打开任务记录/u }));
    fireEvent.click(screen.getByRole("button", { name: /追溯与恢复/u }));

    expect(content.openOperation).toHaveBeenNthCalledWith(1, "operation-1", "commit");
    expect(content.openOperation).toHaveBeenNthCalledWith(2, "operation-1", "recovery");
  });

  test("renders parallel branches and gives bypassed nodes no fabricated percentage", () => {
    const active = operation({
      status: "running",
      statusLabel: "正在处理",
      stageLabel: "融合处理通道正在写入素材",
      completedItems: 4,
      progressPercent: 40,
      completedAt: null,
      canRecover: false,
    });
    const content = workbenchContent({
      operations: [active],
      activeOperation: active,
    });
    const { container } = render(
      <DialArchiveSpacePage
        space={getHomeSpace("preparation")}
        content={content}
        onNavigateSpace={vi.fn()}
        onReturnHome={vi.fn()}
      />,
    );

    const geometry = screen.getByRole("button", { name: "检查节点 尺寸与几何" });
    const encoding = screen.getByRole("button", { name: "检查节点 格式与编码" });
    const identity = screen.getByRole("button", { name: "检查节点 文件与身份" });

    expect(geometry.textContent).toContain("SHARED PASS");
    expect(geometry.textContent).toContain("40%");
    expect(identity.textContent).toContain("SHARED PASS");
    expect(identity.textContent).toContain("40%");
    expect(encoding.textContent).toContain("BYPASSED");
    expect(encoding.textContent).not.toContain("40%");
    expect(
      container.querySelector('[data-edge-id="scope-identity"]')?.getAttribute("class"),
    ).toContain("is-active");
    expect(
      container.querySelector('[data-edge-id="scope-encoding"]')?.getAttribute("class"),
    ).toContain("is-bypassed");
  });

  test("keeps parameter controls wired through the neutral workbench contract", () => {
    const content = workbenchContent();
    render(
      <DialArchiveSpacePage
        space={getHomeSpace("preparation")}
        content={content}
        onNavigateSpace={vi.fn()}
        onReturnHome={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "检查节点 格式与编码" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "启用格式与编码" }));

    expect(content.updateForm).toHaveBeenCalledWith({ convertEnabled: true });
  });
});
