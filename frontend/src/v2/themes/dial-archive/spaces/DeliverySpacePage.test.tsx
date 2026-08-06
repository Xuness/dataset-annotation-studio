import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { getHomeSpace } from "../../../navigation/spaceRegistry";
import {
  type DeliveryManifestSummary,
  type DeliveryOperationSummary,
  type DeliveryPreviewSummary,
  type DeliverySpaceContent,
  type DeliveryWorkbenchContent,
} from "../../../pages/spaces/spacePageModel";
import { DialArchiveSpacePage } from "./DialArchiveSpacePage";

const originalMatchMedia = Object.getOwnPropertyDescriptor(window, "matchMedia");

function manifest(overrides: Partial<DeliveryManifestSummary> = {}): DeliveryManifestSummary {
  return {
    source: "draft",
    scope: "all",
    scopeLabel: "当前项目",
    itemCount: 82,
    selections: [
      {
        id: "tags:::",
        channel: "tags",
        code: "TAG.01",
        label: "Tags",
        detail: "标签标注",
        revision: "current",
        revisionLabel: "当前版本",
      },
    ],
    formats: ["txt"],
    formatLabel: "TXT",
    packaging: "directory",
    packagingLabel: "文件夹",
    destinationPath: "D:\\exports\\portrait-set",
    destinationLabel: "portrait-set",
    draft: true,
    ...overrides,
  };
}

function operation(overrides: Partial<DeliveryOperationSummary> = {}): DeliveryOperationSummary {
  return {
    id: "operation-12345678",
    shortId: "12345678",
    status: "running",
    statusLabel: "正在写入",
    statusCode: "RUNNING",
    tone: "active",
    createdAt: "2026-08-06T04:00:00Z",
    completedAt: null,
    destinationPath: "D:\\exports\\portrait-set",
    totalItems: 82,
    completedItems: 24,
    progressPercent: 29,
    totalBytes: 1024,
    copiedBytes: 384,
    warningCount: 3,
    currentRelativePath: "images/0024.png",
    errorMessage: null,
    canStop: true,
    canResume: false,
    canOpenFolder: true,
    manifest: manifest({ source: "operation", draft: false }),
    ...overrides,
  };
}

function secondaryContent(overrides: Partial<DeliverySpaceContent> = {}): DeliverySpaceContent {
  return {
    kind: "delivery",
    status: "ready",
    project: {
      id: "project-1",
      name: "Portrait Set",
      rootPath: "D:\\datasets\\portraits",
      exists: true,
      assetCount: 82,
      annotatedCount: 79,
      invalidCount: 0,
    },
    checkedCount: 7,
    manifest: manifest(),
    operations: [],
    focusOperation: null,
    activeOperation: null,
    message: null,
    openArchive: vi.fn(),
    openQuality: vi.fn(),
    openWorkbench: vi.fn(),
    openFolder: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function preview(): DeliveryPreviewSummary {
  return {
    token: "preview-token-12345678",
    totalItems: 82,
    usableCount: 78,
    reviewedCount: 46,
    unreviewedCount: 32,
    staleCount: 3,
    missingCount: 1,
    emptyCount: 0,
    invalidCount: 0,
    encodingErrorCount: 0,
    warningCount: 4,
    blockingIssueCount: 0,
    blockingIssues: [],
    imageBytes: 4096,
    annotationBytes: 1024,
    truncated: false,
    items: [
      {
        assetId: "asset-1",
        sourceRelativePath: "images/000001.png",
        targetImageName: "000001.png",
        targetAnnotationName: "000001.txt",
        targetOutputs: ["images/000001.png", "tags/000001.txt"],
        annotationStatus: "stale",
        channelStatuses: { tags: "stale" },
        imageBytes: 1024,
        annotationBytes: 100,
        warningCode: "stale",
        warningMessage: "来源已变化",
        blockingIssue: null,
      },
    ],
  };
}

function workbenchContent(
  overrides: Partial<DeliveryWorkbenchContent> = {},
): DeliveryWorkbenchContent {
  return {
    kind: "delivery-workbench",
    status: "ready",
    project: {
      id: "project-1",
      name: "Portrait Set",
      rootPath: "D:\\datasets\\portraits",
      exists: true,
      assetCount: 82,
      annotatedCount: 79,
      invalidCount: 0,
    },
    phase: "spec",
    form: {
      scope: "all",
      destinationPath: "D:\\exports\\portrait-set",
      selections: [{ channel: "tags", language: "", revision: "current" }],
      formats: ["txt"],
      packaging: "directory",
    },
    manifest: manifest(),
    assetCount: 82,
    checkedCount: 7,
    preview: null,
    previewPending: false,
    exportPending: false,
    canPreview: true,
    canExport: false,
    operations: [],
    activeOperation: null,
    selectedOperation: null,
    error: null,
    dialog: null,
    updateForm: vi.fn(),
    chooseDestination: vi.fn().mockResolvedValue(undefined),
    previewAction: vi.fn().mockResolvedValue(undefined),
    startExport: vi.fn().mockResolvedValue(undefined),
    stopOperation: vi.fn().mockResolvedValue(undefined),
    resumeOperation: vi.fn().mockResolvedValue(undefined),
    openFolder: vi.fn().mockResolvedValue(undefined),
    selectOperation: vi.fn(),
    returnToSpec: vi.fn(),
    resolveDialog: vi.fn(),
    returnToSpace: vi.fn(),
    openQuality: vi.fn(),
    openArchive: vi.fn(),
    ...overrides,
  };
}

describe("dial archive delivery pages", () => {
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
    vi.restoreAllMocks();
    if (originalMatchMedia) Object.defineProperty(window, "matchMedia", originalMatchMedia);
    else Reflect.deleteProperty(window, "matchMedia");
  });

  test("keeps the secondary page as a manifest entrance with optional quality routing", () => {
    const content = secondaryContent();
    render(
      <DialArchiveSpacePage
        space={getHomeSpace("delivery")}
        content={content}
        onNavigateSpace={vi.fn()}
        onReturnHome={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /继续编辑方案/u }));
    fireEvent.click(screen.getByRole("button", { name: /查看 04 质量状态/u }));

    expect(content.openWorkbench).toHaveBeenCalledWith(undefined);
    expect(content.openQuality).toHaveBeenCalledWith("needs_review");
  });

  test("opens a concrete operation from the delivery log", () => {
    const current = operation();
    const content = secondaryContent({
      operations: [current],
      focusOperation: current,
      activeOperation: current,
      manifest: current.manifest,
    });
    render(
      <DialArchiveSpacePage
        space={getHomeSpace("delivery")}
        content={content}
        onNavigateSpace={vi.fn()}
        onReturnHome={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "打开交付记录 12345678" }));
    expect(content.openWorkbench).toHaveBeenCalledWith("operation-12345678");
  });

  test("maps a vertical wheel gesture onto the horizontal delivery log", () => {
    const current = operation();
    render(
      <DialArchiveSpacePage
        space={getHomeSpace("delivery")}
        content={secondaryContent({ operations: [current] })}
        onNavigateSpace={vi.fn()}
        onReturnHome={vi.fn()}
      />,
    );
    const track = screen.getByRole("region", { name: "可滚动交付记录" });
    Object.defineProperty(track, "clientWidth", { configurable: true, value: 300 });
    Object.defineProperty(track, "scrollWidth", { configurable: true, value: 900 });
    Object.defineProperty(track, "scrollLeft", { configurable: true, value: 0, writable: true });

    fireEvent.wheel(track, { deltaY: 96 });

    expect(track.scrollLeft).toBe(96);
  });

  test("keeps specification controls wired to the export session contract", () => {
    const content = workbenchContent();
    render(
      <DialArchiveSpacePage
        space={getHomeSpace("delivery")}
        content={content}
        onNavigateSpace={vi.fn()}
        onReturnHome={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /工作台已选/u }));
    fireEvent.click(screen.getByRole("button", { name: /DSC\.02.*LLM 描述/u }));
    fireEvent.click(screen.getByRole("button", { name: /生成预检/u }));

    expect(content.updateForm).toHaveBeenCalledWith({ scope: "selected" });
    expect(content.updateForm).toHaveBeenCalledWith({
      selections: [
        { channel: "tags", language: "", revision: "current" },
        { channel: "description", language: "", revision: "current" },
      ],
    });
    expect(content.previewAction).toHaveBeenCalledOnce();
  });

  test("treats quality review as optional while a warning preflight can continue", () => {
    const currentPreview = preview();
    const content = workbenchContent({
      phase: "preflight",
      preview: currentPreview,
      canExport: true,
    });
    render(
      <DialArchiveSpacePage
        space={getHomeSpace("delivery")}
        content={content}
        onNavigateSpace={vi.fn()}
        onReturnHome={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /过期/u }));
    fireEvent.click(screen.getByRole("button", { name: /确认并开始交付/u }));

    expect(content.openQuality).toHaveBeenCalledWith("stale");
    expect(content.startExport).toHaveBeenCalledOnce();
  });

  test("returns from an archived record to the actual active delivery", () => {
    const active = operation();
    const completed = operation({
      id: "completed-87654321",
      shortId: "COMPLETE",
      status: "completed",
      statusLabel: "交付完成",
      statusCode: "COMPLETED",
      tone: "success",
      completedItems: 82,
      progressPercent: 100,
      canStop: false,
    });
    const content = workbenchContent({
      phase: "materialize",
      operations: [active, completed],
      activeOperation: active,
      selectedOperation: completed,
      manifest: completed.manifest,
    });
    render(
      <DialArchiveSpacePage
        space={getHomeSpace("delivery")}
        content={content}
        onNavigateSpace={vi.fn()}
        onReturnHome={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "返回当前写入" }));

    expect(content.selectOperation).toHaveBeenCalledWith(active.id);
  });
});
