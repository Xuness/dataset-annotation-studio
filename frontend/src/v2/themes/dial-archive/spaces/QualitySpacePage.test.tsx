import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { getHomeSpace } from "../../../navigation/spaceRegistry";
import type {
  QualityAsset,
  QualityReviewContent,
  QualitySpaceContent,
} from "../../../pages/spaces/spacePageModel";
import {
  QUALITY_FILTER_IDS,
  QUALITY_QUEUE_PRESENTATION,
  type QualityQueueSummary,
} from "../../../pages/spaces/spacePageModel";
import { DialArchiveSpacePage } from "./DialArchiveSpacePage";

const originalMatchMedia = Object.getOwnPropertyDescriptor(window, "matchMedia");

function projectQualityQueues(
  counts: Readonly<Record<string, number>>,
): readonly QualityQueueSummary[] {
  return QUALITY_FILTER_IDS.map((id) => ({
    id,
    ...QUALITY_QUEUE_PRESENTATION[id],
    count: counts[id] ?? 0,
  }));
}

function qualityAsset(id = "asset-1"): QualityAsset {
  return {
    id,
    filename: `${id}.png`,
    relativePath: `images/${id}.png`,
    width: 1024,
    height: 1536,
    byteSize: 1200,
    suffix: ".png",
    imageUrl: `/image/${id}`,
    thumbnailUrl: `/thumbnail/${id}`,
    annotationStatus: "valid",
    channelStatuses: { tags: "unreviewed", description: "usable" },
  };
}

const channels = [
  {
    id: "tags" as const,
    activeDocumentCount: 42,
    presentAssetCount: 42,
    usableAssetCount: 40,
    staleAssetCount: 1,
    invalidAssetCount: 1,
    missingAssetCount: 0,
    coveragePercent: 95,
  },
  {
    id: "description" as const,
    activeDocumentCount: 38,
    presentAssetCount: 38,
    usableAssetCount: 36,
    staleAssetCount: 2,
    invalidAssetCount: 0,
    missingAssetCount: 4,
    coveragePercent: 86,
  },
  {
    id: "translation" as const,
    activeDocumentCount: 30,
    presentAssetCount: 30,
    usableAssetCount: 28,
    staleAssetCount: 2,
    invalidAssetCount: 0,
    missingAssetCount: 12,
    coveragePercent: 67,
  },
];

function qualityContent(overrides: Partial<QualitySpaceContent> = {}): QualitySpaceContent {
  const asset = qualityAsset();
  return {
    kind: "quality",
    status: "ready",
    project: {
      id: "project-1",
      name: "Portrait Set",
      rootPath: "D:\\datasets\\portraits",
      exists: true,
      assetCount: 42,
      annotatedCount: 40,
      invalidCount: 1,
    },
    focusAsset: asset,
    focusIndex: 0,
    samples: [asset, qualityAsset("asset-2")],
    totalCount: 17,
    loadedCount: 2,
    fetchingMore: false,
    hasMore: true,
    filter: "needs_review",
    channel: "tags",
    queues: projectQualityQueues({ all: 42, needs_review: 17, unreviewed: 15, stale: 1 }),
    channels,
    translationVariants: [],
    checkedCount: 3,
    statusCounts: { all: 42, needs_review: 17, unreviewed: 15, stale: 1 },
    message: null,
    selectAsset: vi.fn(),
    selectFilter: vi.fn(),
    selectChannel: vi.fn(),
    loadMore: vi.fn(),
    openReview: vi.fn(),
    openAnnotation: vi.fn(),
    openArchive: vi.fn(),
    openDelivery: vi.fn(),
    ...overrides,
  };
}

function reviewContent(overrides: Partial<QualityReviewContent> = {}): QualityReviewContent {
  const asset = qualityAsset();
  return {
    kind: "quality-review",
    status: "ready",
    project: {
      id: "project-1",
      name: "Portrait Set",
      rootPath: "D:\\datasets\\portraits",
      exists: true,
      assetCount: 42,
      annotatedCount: 40,
      invalidCount: 1,
    },
    sequence: {
      assets: [asset, qualityAsset("asset-2")],
      totalCount: 17,
      loadedCount: 2,
      fetchingMore: false,
      hasMore: false,
      loadError: null,
      loadMore: vi.fn(),
    },
    currentAsset: asset,
    currentIndex: 0,
    filter: "needs_review",
    channel: "tags",
    queues: projectQualityQueues({ all: 42, needs_review: 17 }),
    documents: [
      {
        id: "tags-doc",
        channel: "tags",
        displayName: "Tags",
        contentKind: "tags",
        content: "",
        tags: [{ name: "1girl", category: "general", confidence: 0.98 }],
        availabilityStatus: "usable",
        reviewStatus: "unreviewed",
        validationStatus: "valid",
        validationIssues: [],
        sourceLabel: "Tagger 生成",
        sourceDetail: null,
        headRevisionId: "revision-1",
        reviewedRevisionId: null,
        updatedAt: "2026-08-06T00:00:00Z",
        language: null,
        translationSourceKind: null,
        translationProducerKind: null,
        canReview: true,
      },
    ],
    activeDocument: {
      id: "tags-doc",
      channel: "tags",
      displayName: "Tags",
      contentKind: "tags",
      content: "",
      tags: [{ name: "1girl", category: "general", confidence: 0.98 }],
      availabilityStatus: "usable",
      reviewStatus: "unreviewed",
      validationStatus: "valid",
      validationIssues: [],
      sourceLabel: "Tagger 生成",
      sourceDetail: null,
      headRevisionId: "revision-1",
      reviewedRevisionId: null,
      updatedAt: "2026-08-06T00:00:00Z",
      language: null,
      translationSourceKind: null,
      translationProducerKind: null,
      canReview: true,
    },
    reviewPending: false,
    actionMessage: null,
    message: null,
    selectAsset: vi.fn(),
    stepAsset: vi.fn(),
    selectChannel: vi.fn(),
    loadMore: vi.fn(),
    reviewCurrent: vi.fn().mockResolvedValue(undefined),
    returnToQuality: vi.fn(),
    openAnnotation: vi.fn(),
    openArchive: vi.fn(),
    ...overrides,
  };
}

describe("dial archive quality space", () => {
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

  test("uses one active gate while keeping all quality routes available", () => {
    const content = qualityContent();
    render(
      <DialArchiveSpacePage
        space={getHomeSpace("quality")}
        content={content}
        onNavigateSpace={vi.fn()}
        onReturnHome={vi.fn()}
      />,
    );

    expect(screen.getByRole("heading", { name: "质量控制" })).toBeTruthy();
    expect(screen.getByRole("complementary", { name: "素材胶片轨道" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "定位素材 asset-2.png" }));
    expect(content.selectAsset).toHaveBeenCalledWith("asset-2");
    const film = screen.getByRole("region", { name: "可滚动素材序列" });
    Object.defineProperties(film, {
      scrollHeight: { configurable: true, value: 1_000 },
      clientHeight: { configurable: true, value: 500 },
      scrollTop: { configurable: true, value: 400, writable: true },
    });
    fireEvent.scroll(film);
    expect(content.loadMore).toHaveBeenCalledOnce();
    const deliveryButtons = screen.getAllByRole("button", { name: /继续至 05 导出/u });
    expect(deliveryButtons).toHaveLength(2);
    fireEvent.click(deliveryButtons[0]);
    expect(content.openDelivery).toHaveBeenCalledOnce();
    expect(screen.getByRole("heading", { name: /EVIDENCE LOG/i })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "切换至 未复核" }));
    expect(content.selectFilter).toHaveBeenCalledWith("unreviewed");
    fireEvent.click(screen.getByRole("button", { name: /进入证据复核台/u }));
    expect(content.openReview).toHaveBeenCalledWith("asset-1", undefined);
  });

  test("keeps object, channel and verdict actions distinct in the review desk", () => {
    const content = reviewContent();
    render(
      <DialArchiveSpacePage
        space={getHomeSpace("quality")}
        content={content}
        onNavigateSpace={vi.fn()}
        onReturnHome={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /描述证据/u }));
    expect(content.selectChannel).toHaveBeenCalledWith("description");
    fireEvent.click(screen.getByRole("button", { name: /确认当前证据/u }));
    expect(content.reviewCurrent).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "下一个复核对象" }));
    expect(content.stepAsset).toHaveBeenCalledWith(1);
  });

  test("directs a missing quality context back to the project archive", () => {
    const content = qualityContent({
      status: "no-context",
      project: null,
      focusAsset: null,
      samples: [],
      channels: [],
    });
    render(
      <DialArchiveSpacePage
        space={getHomeSpace("quality")}
        content={content}
        onNavigateSpace={vi.fn()}
        onReturnHome={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /装载项目源/u }));
    expect(content.openArchive).toHaveBeenCalledOnce();
  });
});
