import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { getHomeSpace } from "../../../navigation/spaceRegistry";
import type {
  AnnotationStageAsset,
  AnnotationStageContent,
} from "../../../pages/spaces/spacePageModel";
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

function stageAsset(id: string, index: number): AnnotationStageAsset {
  return {
    id,
    filename: `${id}.png`,
    relativePath: `images/${id}.png`,
    width: 1024,
    height: 768,
    byteSize: 1_048_576,
    suffix: ".png",
    imageUrl: `/image/${id}`,
    thumbnailUrl: `/thumbnail/${id}`,
    annotationStatus: index % 2 === 0 ? "valid" : "missing",
    channelStatuses: index % 2 === 0 ? { tags: "valid" } : {},
  };
}

function stageContent(overrides: Partial<AnnotationStageContent> = {}): AnnotationStageContent {
  const assets = [stageAsset("asset-1", 0), stageAsset("asset-2", 1), stageAsset("asset-3", 2)];
  return {
    kind: "annotation-stage",
    status: "ready",
    project: {
      id: "project-1",
      name: "Portrait Set",
      rootPath: "D:\\datasets\\portraits",
      exists: true,
      assetCount: 3,
      annotatedCount: 2,
      invalidCount: 0,
    },
    sequence: {
      assets,
      totalCount: 3,
      loadedCount: 3,
      fetchingMore: false,
      hasMore: false,
      loadError: null,
      loadMore: vi.fn(),
    },
    currentAsset: assets[0],
    currentIndex: 0,
    checkedAssetIds: [],
    channels: [],
    operation: null,
    initialWorkcell: null,
    initialLane: null,
    message: null,
    selectAsset: vi.fn(),
    stepAsset: vi.fn(),
    toggleAssetChecked: vi.fn(),
    openWorkcell: vi.fn(),
    closeWorkcell: vi.fn(),
    returnToSpace: vi.fn(),
    openArchive: vi.fn(),
    ...overrides,
  };
}

function renderStage(content: AnnotationStageContent) {
  return render(
    <DialArchiveSpacePage
      space={getHomeSpace("annotation")}
      content={content}
      onNavigateSpace={vi.fn()}
      onReturnHome={vi.fn()}
    />,
  );
}

describe("dial archive annotation stage", () => {
  beforeEach(() => mockMatchMedia(true));

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    if (originalMatchMedia) Object.defineProperty(window, "matchMedia", originalMatchMedia);
    else Reflect.deleteProperty(window, "matchMedia");
  });

  test("presents the current material and true sequence readings", () => {
    renderStage(stageContent());

    expect(screen.getByRole("region", { name: "素材施工场" })).not.toBeNull();
    expect(screen.getByRole("group", { name: "素材 asset-1.png 查看器" })).not.toBeNull();
    expect(screen.getByRole("group", { name: "图片观察工具" })).not.toBeNull();
    expect(screen.getByText("0001")).not.toBeNull();
    expect(screen.getByText("3 MATERIAL")).not.toBeNull();
  });

  test("inspects the true-color image with normal-wheel zoom, actual size, and drag pan", () => {
    renderStage(stageContent());

    const viewer = screen.getByRole("group", { name: "素材 asset-1.png 查看器" });
    Object.defineProperties(viewer, {
      clientWidth: { configurable: true, value: 800 },
      clientHeight: { configurable: true, value: 500 },
    });
    vi.spyOn(viewer, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      top: 0,
      right: 800,
      bottom: 500,
      left: 0,
      width: 800,
      height: 500,
      toJSON: () => ({}),
    });

    fireEvent.click(screen.getByRole("button", { name: "1:1" }));
    expect(screen.getByLabelText("图片缩放比例")).toHaveProperty("value", "100%");
    fireEvent.wheel(viewer, { deltaY: -120, clientX: 400, clientY: 250 });
    expect(screen.getByLabelText("图片缩放比例")).not.toHaveProperty("value", "100%");

    const surface = screen.getByAltText("asset-1.png").parentElement;
    fireEvent.pointerDown(viewer, { button: 0, pointerId: 7, clientX: 400, clientY: 250 });
    fireEvent.pointerMove(viewer, { pointerId: 7, clientX: 450, clientY: 290 });
    fireEvent.pointerUp(viewer, { pointerId: 7, clientX: 450, clientY: 290 });
    expect(surface?.style.transform).toBe("translate3d(50px, 40px, 0)");
  });

  test("keeps current-object selection and range toggling as two gestures", () => {
    const content = stageContent();
    renderStage(content);

    const cell = screen.getByRole("button", { name: "查看素材 asset-2.png" });
    fireEvent.click(cell);
    expect(content.selectAsset).toHaveBeenCalledWith("asset-2");
    expect(content.toggleAssetChecked).not.toHaveBeenCalled();

    fireEvent.click(cell, { altKey: true });
    expect(content.toggleAssetChecked).toHaveBeenCalledWith("asset-2");
  });

  test("keeps the filmstrip viewport still when a visible material becomes current", () => {
    const rect = (left: number, top: number, width: number, height: number) =>
      ({
        x: left,
        y: top,
        top,
        right: left + width,
        bottom: top + height,
        left,
        width,
        height,
        toJSON: () => ({}),
      }) satisfies DOMRect;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
      this: HTMLElement,
    ) {
      if (this.classList.contains("dial-archive-stage-filmstrip")) return rect(0, 0, 1_000, 164);
      const filmIndex = this.getAttribute("data-film-index");
      if (filmIndex !== null) return rect(650 + Number(filmIndex) * 130, 24, 144, 96);
      return rect(0, 0, 0, 0);
    });

    const { container } = renderStage(stageContent());
    const track = container.querySelector<HTMLElement>(".dial-archive-stage-filmstrip__track");
    expect(track?.style.transform).toBe("translateX(0px)");

    fireEvent.click(screen.getByRole("button", { name: "查看素材 asset-3.png" }));

    expect(track?.style.transform).toBe("translateX(0px)");
    expect(screen.getByRole("button", { name: "查看素材 asset-3.png" }).className).toContain(
      "is-current",
    );
  });

  test("marks ranged materials with the bite while the current one keeps its identity frame", () => {
    const content = stageContent({ checkedAssetIds: ["asset-2"] });
    renderStage(content);

    const current = screen.getByRole("button", { name: "查看素材 asset-1.png" });
    const ranged = screen.getByRole("button", { name: "查看素材 asset-2.png" });
    expect(current.className).toContain("is-current");
    expect(current.className).not.toContain("is-ranged");
    expect(ranged.className).toContain("is-ranged");
    expect(ranged.className).not.toContain("is-current");
  });

  test("coalesces rapid keyboard intent after a child control receives focus", () => {
    const content = stageContent();
    renderStage(content);

    const focusedCell = screen.getByRole("button", { name: "查看素材 asset-1.png" });
    focusedCell.focus();
    fireEvent.keyDown(focusedCell, { key: "ArrowRight" });
    fireEvent.keyDown(focusedCell, { key: "ArrowRight" });

    expect(content.selectAsset).toHaveBeenNthCalledWith(1, "asset-2");
    expect(content.selectAsset).toHaveBeenNthCalledWith(2, "asset-3");
    expect(screen.getByText("0003")).not.toBeNull();
  });

  test("steps the optimistic sequence from the instrument pager", () => {
    const content = stageContent();
    renderStage(content);

    fireEvent.click(screen.getByRole("button", { name: "下一张素材" }));
    expect(content.selectAsset).toHaveBeenCalledWith("asset-2");
    expect(screen.getByRole("button", { name: "上一张素材" })).toHaveProperty("disabled", false);
  });

  test("moves the bounded camera only when the gesture starts on blank stage space", () => {
    renderStage(stageContent());

    const stage = screen.getByRole("region", { name: "素材施工场" });
    const lockedControl = screen.getByRole("button", { name: /RESET 0\.0/u });
    fireEvent.pointerDown(lockedControl, {
      button: 0,
      pointerId: 1,
      clientX: 100,
      clientY: 100,
    });
    fireEvent.pointerMove(stage, { pointerId: 1, clientX: 140, clientY: 122 });
    expect(stage.style.getPropertyValue("--dial-archive-stage-camera-x")).toBe("0px");

    fireEvent.pointerDown(stage, { button: 0, pointerId: 2, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(stage, { pointerId: 2, clientX: 440, clientY: 300 });
    fireEvent.pointerUp(stage, { pointerId: 2, clientX: 440, clientY: 300 });
    expect(stage.style.getPropertyValue("--dial-archive-stage-camera-x")).toBe("76px");
    expect(stage.style.getPropertyValue("--dial-archive-stage-camera-y")).toBe("44px");

    fireEvent.click(lockedControl);
    expect(stage.style.getPropertyValue("--dial-archive-stage-camera-x")).toBe("0px");
    expect(stage.style.getPropertyValue("--dial-archive-stage-camera-y")).toBe("0px");
  });

  test("opens each workcell through the depth stack", () => {
    const content = stageContent();
    renderStage(content);

    fireEvent.click(screen.getByRole("button", { name: /展开生产工作间/u }));
    expect(content.openWorkcell).toHaveBeenCalledWith("production");

    fireEvent.click(screen.getByRole("button", { name: /展开档案工作间/u }));
    expect(content.openWorkcell).toHaveBeenCalledWith("dossier");

    fireEvent.click(screen.getByRole("button", { name: "打开标注编辑工作间" }));
    expect(content.openWorkcell).toHaveBeenCalledWith("edit");
  });

  test("shows the live operation reading on the production card", () => {
    renderStage(
      stageContent({
        operation: {
          id: "job-1",
          kind: "annotation",
          lane: "tags",
          status: "running",
          statusLabel: "正在生产",
          progressPercent: 62,
          completedItems: 62,
          totalItems: 100,
          failedItems: 0,
          targetLanguage: null,
          executionProfileName: "default",
          model: "wd-tagger",
          createdAt: "2026-08-04T10:00:00Z",
          updatedAt: "2026-08-04T10:05:00Z",
          active: true,
        },
      }),
    );

    expect(screen.getByText("正在生产 62%")).not.toBeNull();
  });

  test("directs an empty context back to the project archive", () => {
    const content = stageContent({
      status: "no-context",
      project: null,
      currentAsset: null,
      currentIndex: -1,
    });
    renderStage(content);

    fireEvent.click(screen.getByRole("button", { name: /进入项目档案/u }));
    expect(content.openArchive).toHaveBeenCalledOnce();
  });

  test("keeps the stage identity when an asset image fails to load", () => {
    const content = stageContent();
    renderStage(content);

    fireEvent.error(screen.getByAltText("asset-1.png"));
    expect(screen.getByText("IMAGE UNAVAILABLE")).not.toBeNull();
    expect(screen.getAllByText("images/asset-1.png").length).toBeGreaterThanOrEqual(1);
  });

  test("offers an explicit retry instead of looping after sequence pagination fails", () => {
    const loadMore = vi.fn();
    renderStage(
      stageContent({
        sequence: {
          ...stageContent().sequence,
          hasMore: true,
          loadError: "下一页读取失败",
          loadMore,
        },
        message: "下一页读取失败",
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: "RETRY SEQUENCE →" }));
    expect(loadMore).toHaveBeenCalledOnce();
  });
});
