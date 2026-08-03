import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { getHomeSpace } from "../../../navigation/spaceRegistry";
import type { AnnotationSpaceContent } from "../../../pages/spaces/spacePageModel";
import { DialArchiveSpacePage } from "./DialArchiveSpacePage";

const originalMatchMedia = Object.getOwnPropertyDescriptor(window, "matchMedia");

function mockMatchMedia(matches: boolean) {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: () =>
      ({
        matches,
        media: "(prefers-reduced-motion: reduce)",
        onchange: null,
        addEventListener() {},
        removeEventListener() {},
        addListener() {},
        removeListener() {},
        dispatchEvent: () => false,
      }) satisfies MediaQueryList,
  });
}

function annotationContent(
  overrides: Partial<AnnotationSpaceContent> = {},
): AnnotationSpaceContent {
  return {
    kind: "annotation",
    status: "ready",
    project: {
      id: "project-1",
      name: "Portrait Set",
      rootPath: "D:\\datasets\\portraits",
      exists: true,
      assetCount: 42,
      annotatedCount: 17,
      invalidCount: 1,
    },
    samples: [
      {
        id: "asset-1",
        filename: "portrait.png",
        relativePath: "images/portrait.png",
        width: 1536,
        height: 2048,
        imageUrl: "/image/asset-1",
        thumbnailUrl: "/thumbnail/asset-1",
        annotationStatus: "valid",
        channelStatuses: { tags: "valid" },
      },
    ],
    checkedCount: 3,
    channels: [
      {
        id: "tags",
        activeDocumentCount: 19,
        presentAssetCount: 19,
        usableAssetCount: 17,
        staleAssetCount: 1,
        invalidAssetCount: 1,
        missingAssetCount: 23,
        coveragePercent: 40,
      },
      {
        id: "description",
        activeDocumentCount: 12,
        presentAssetCount: 12,
        usableAssetCount: 12,
        staleAssetCount: 0,
        invalidAssetCount: 0,
        missingAssetCount: 30,
        coveragePercent: 29,
      },
      {
        id: "translation",
        activeDocumentCount: 8,
        presentAssetCount: 6,
        usableAssetCount: 5,
        staleAssetCount: 1,
        invalidAssetCount: 0,
        missingAssetCount: 36,
        coveragePercent: 12,
      },
    ],
    translationVariants: [
      {
        id: "zh-CN:description:llm",
        language: "zh-CN",
        sourceKind: "description",
        producerKind: "llm",
        displayName: "中文描述",
        presentAssetCount: 6,
        usableAssetCount: 5,
        staleAssetCount: 1,
        invalidAssetCount: 0,
        missingAssetCount: 36,
      },
    ],
    contextSignals: [
      {
        id: "system-prompt",
        state: "ready",
        value: "General Vision",
        detail: "项目已绑定可用的 System Prompt 预设。",
      },
    ],
    operation: null,
    message: null,
    openArchive: vi.fn(),
    openWorkbench: vi.fn(),
    openProduction: vi.fn(),
    ...overrides,
  };
}

describe("dial archive annotation space", () => {
  beforeEach(() => mockMatchMedia(true));

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
    if (originalMatchMedia) Object.defineProperty(window, "matchMedia", originalMatchMedia);
    else Reflect.deleteProperty(window, "matchMedia");
  });

  test("keeps material and automatic channel entrances semantically distinct", () => {
    const content = annotationContent();
    render(
      <DialArchiveSpacePage
        space={getHomeSpace("annotation")}
        content={content}
        onNavigateSpace={vi.fn()}
        onReturnHome={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "打开素材 portrait.png" }));
    fireEvent.click(screen.getByRole("button", { name: /编辑 Tags/u }));
    fireEvent.click(screen.getByRole("button", { name: /建立 Tagger 线路/u }));

    expect(content.openWorkbench).toHaveBeenNthCalledWith(1, "asset-1", undefined);
    expect(content.openWorkbench).toHaveBeenNthCalledWith(2, "asset-1", "tags");
    expect(content.openProduction).toHaveBeenCalledWith("tags", undefined);
  });

  test("renders translation identities without flattening them into one count", () => {
    render(
      <DialArchiveSpacePage
        space={getHomeSpace("annotation")}
        content={annotationContent()}
        onNavigateSpace={vi.fn()}
        onReturnHome={vi.fn()}
      />,
    );

    expect(screen.getByText("中文描述")).not.toBeNull();
    expect(screen.getByText(/ZH-CN · DESCRIPTION · LLM/iu)).not.toBeNull();
  });

  test("uses the shared workroom sweep before committing navigation", () => {
    mockMatchMedia(false);
    vi.useFakeTimers();
    const content = annotationContent();
    render(
      <DialArchiveSpacePage
        space={getHomeSpace("annotation")}
        content={content}
        onNavigateSpace={vi.fn()}
        onReturnHome={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /创建自动生产任务/u }));

    expect(content.openProduction).not.toHaveBeenCalled();
    expect(screen.getByText("ENTERING // ANN — PRODUCTION ROUTE")).not.toBeNull();

    act(() => vi.advanceTimersByTime(520));
    expect(content.openProduction).toHaveBeenCalledWith(undefined, undefined);
  });

  test("directs an empty context back to the project archive", () => {
    const content = annotationContent({
      status: "no-context",
      project: null,
      samples: [],
      channels: [],
      translationVariants: [],
      contextSignals: [],
    });
    render(
      <DialArchiveSpacePage
        space={getHomeSpace("annotation")}
        content={content}
        onNavigateSpace={vi.fn()}
        onReturnHome={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /进入项目档案/u }));
    expect(content.openArchive).toHaveBeenCalledOnce();
  });
});
