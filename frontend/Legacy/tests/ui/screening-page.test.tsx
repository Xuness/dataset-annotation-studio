import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, describe, expect, test, vi } from "vitest";

vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getTotalSize: () => count * 224,
    getVirtualItems: () =>
      Array.from({ length: count }, (_, index) => ({
        index,
        start: index * 224,
        end: (index + 1) * 224,
        size: 224,
      })),
    measureElement: vi.fn(),
    measure: vi.fn(),
    scrollToIndex: vi.fn(),
  }),
}));

import { NavigationRail } from "../../layouts/workspace/NavigationRail";
import { ScreeningResultGallery } from "../../pages/screening/components/ScreeningResultGallery";
import type { ScreeningItem } from "../../../src/shared/api/types";

afterEach(cleanup);

function LocationProbe() {
  return <output aria-label="当前位置">{useLocation().pathname}</output>;
}

const item: ScreeningItem = {
  asset_id: "asset-1",
  source_relative_path: "characters/hero.png",
  image_width: 1024,
  image_height: 1536,
  metadata_relative_path: "characters/hero.json",
  status: "scored",
  rating: "s",
  created_at: "2026-08-12T08:00:00Z",
  metadata_snapshot_at: "2026-08-13T08:00:00Z",
  age_hours: 24,
  age_bucket: "1-3d",
  fav_count: 120,
  up_score: 110,
  downvote_count: 1,
  evidence_mass: 231,
  confidence_pop: 0.86,
  confidence_depth: 0.9,
  confidence_vote: 0.88,
  technical_score: 0.88,
  final_score: 0.94,
  keep_score: 0.91,
  elite_score: 0.96,
  rating_rank: 1,
  rating_percentile: 0.99,
  task_fit_score: 1,
  selection_score: 0.94,
  selection_rank: 1,
  selection_percentile: 0.99,
  task_reason_codes: [],
  task_matched_tags: [],
  quality_candidate_pool: "elite_candidate",
  candidate_pool: "elite_candidate",
  low_resolution_flag: false,
  pixel_duplicate_group: null,
  variant_group: null,
  duplicate_representative: true,
  duplicate_of_asset_id: null,
  source_post_id: "11956520",
  is_candidate: false,
  candidate_elsewhere: [
    {
      asset_id: "columbina-asset",
      source_relative_path: "Columbina/rating_g/11956520.png",
      match_kind: "danbooru_post",
    },
  ],
  score_details: {
    popularity_percentile_raw: 0.9,
    popularity_percentile_final: 0.9,
    depth_percentile_raw: 0.8,
    depth_percentile_final: 0.8,
    vote_posterior_mean: 0.99,
    vote_posterior_lower_95: 0.95,
    vote_percentile_mean: 0.95,
    vote_percentile_lower: 0.9,
    vote_keep_signal: 0.95,
    bad_pop: 0,
    bad_depth: 0,
    bad_vote: 0,
    bad_consensus_second: 0,
  },
  reason_codes: ["HIGH_BATCH_PERCENTILE"],
  warnings: [],
  error_code: null,
  error_message: null,
};

describe("legacy screening workspace", () => {
  test("adds screening between assets and preprocessing in the primary rail", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/workspace/project-1"]}>
        <NavigationRail projectId="project-1" active="assets" />
        <LocationProbe />
      </MemoryRouter>,
    );

    const labels = screen
      .getAllByRole("button")
      .map((button) => button.textContent?.trim())
      .filter(Boolean);
    expect(labels.indexOf("素材")).toBeLessThan(labels.indexOf("筛选"));
    expect(labels.indexOf("筛选")).toBeLessThan(labels.indexOf("预处理"));

    await user.click(screen.getByRole("button", { name: "筛选" }));
    expect(screen.getByRole("status", { name: "当前位置" }).textContent).toBe(
      "/workspace/project-1/screening",
    );
  });

  test("renders batch-only result cards and forwards current-result selection", async () => {
    const user = userEvent.setup();
    const changeFilters = vi.fn();
    const changeThumbnailSize = vi.fn();
    const setChecked = vi.fn();
    const selectCurrent = vi.fn();
    const updateCandidates = vi.fn();

    render(
      <ScreeningResultGallery
        projectId="project-1"
        operationId="operation-1"
        items={[item]}
        total={1}
        filters={{
          pool: null,
          rating: null,
          flag: null,
          sort: "selection",
          showDuplicates: false,
        }}
        thumbnailSize={240}
        selectedAssetId={null}
        checkedAssetIds={[]}
        loading={false}
        fetching={false}
        processing={false}
        error={null}
        hasMore={false}
        selectCurrentPending={false}
        candidateUpdatePending={false}
        candidateCount={0}
        candidateMessage={null}
        allCurrentResultsChecked={false}
        onChangeFilters={changeFilters}
        onThumbnailSizeChange={changeThumbnailSize}
        onSelectAsset={() => undefined}
        onSetChecked={setChecked}
        onLoadMore={() => undefined}
        onSelectCurrent={selectCurrent}
        onUpdateCandidates={updateCandidates}
      />,
    );

    expect(screen.getByText("hero.png")).toBeTruthy();
    expect(screen.getByText("任务百分位 99.0% · #1")).toBeTruthy();
    expect(screen.getByText("Columbina 已候选")).toBeTruthy();
    expect(screen.getByText("240px")).toBeTruthy();

    expect(
      screen.getByRole("checkbox", { name: "勾选 hero.png" }).getAttribute("aria-checked"),
    ).toBe("false");

    await user.click(screen.getByRole("button", { name: "放大缩略图" }));
    expect(changeThumbnailSize).toHaveBeenCalledWith(280);

    const gallery = screen.getByRole("region", { name: "筛选结果画廊" });
    fireEvent.wheel(gallery, { deltaY: 100 });
    expect(changeThumbnailSize).toHaveBeenCalledTimes(1);
    fireEvent.wheel(gallery, { ctrlKey: true, deltaY: 100 });
    expect(changeThumbnailSize).toHaveBeenLastCalledWith(200);

    await user.click(screen.getByRole("button", { name: "精选" }));
    expect(changeFilters).toHaveBeenCalledWith({ pool: "elite_candidate" });

    await user.selectOptions(screen.getByLabelText("排序"), "percentile");
    expect(changeFilters).toHaveBeenCalledWith({ sort: "percentile" });

    await user.selectOptions(screen.getByLabelText("标记"), "pixel_duplicate");
    expect(changeFilters).toHaveBeenCalledWith({ flag: "pixel_duplicate" });

    await user.click(screen.getByRole("checkbox", { name: "显示重复图" }));
    expect(changeFilters).toHaveBeenCalledWith({ showDuplicates: true });

    await user.click(screen.getByRole("checkbox", { name: "勾选 hero.png" }));
    expect(setChecked).toHaveBeenCalledWith(["asset-1"], true);

    await user.click(screen.getByRole("button", { name: "查看 hero.png 大图" }));
    const lightbox = screen.getByRole("dialog", { name: "hero.png" });
    expect(lightbox).toBeTruthy();
    expect(screen.getByRole("img", { name: "hero.png" }).getAttribute("src")).toContain(
      "/assets/asset-1/image",
    );
    expect(setChecked).toHaveBeenCalledTimes(1);

    const largeImageViewport = screen.getByLabelText("大图查看区域");
    const zoomReadout = screen.getByLabelText("大图缩放比例");
    const initialZoom = zoomReadout.textContent;
    fireEvent.wheel(largeImageViewport, { clientX: 640, clientY: 360, deltaY: -240 });
    await waitFor(() => expect(zoomReadout.textContent).not.toBe(initialZoom));

    for (let index = 0; index < 5; index += 1) {
      await user.click(screen.getByRole("button", { name: "放大大图" }));
    }
    const largeImage = screen.getByRole("img", { name: "hero.png" });
    const transformBeforePan = largeImage.style.transform;
    fireEvent.pointerDown(largeImageViewport, {
      button: 0,
      pointerId: 1,
      clientX: 300,
      clientY: 300,
    });
    fireEvent.pointerMove(largeImageViewport, { pointerId: 1, clientX: 340, clientY: 360 });
    fireEvent.pointerUp(largeImageViewport, { pointerId: 1, clientX: 340, clientY: 360 });
    await waitFor(() => expect(largeImage.style.transform).not.toBe(transformBeforePan));

    await user.click(screen.getByRole("button", { name: "适应窗口" }));
    expect(zoomReadout.textContent).toBe(initialZoom);
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "hero.png" })).toBeNull());

    await user.click(screen.getByRole("button", { name: "勾选当前结果" }));
    expect(selectCurrent).toHaveBeenCalledOnce();
  });

  test("keeps result thumbnails unloaded while the selected operation is running", () => {
    render(
      <ScreeningResultGallery
        projectId="project-1"
        operationId="operation-1"
        items={[]}
        total={0}
        filters={{
          pool: null,
          rating: null,
          flag: null,
          sort: "selection",
          showDuplicates: false,
        }}
        thumbnailSize={240}
        selectedAssetId={null}
        checkedAssetIds={[]}
        loading={false}
        fetching={false}
        processing
        error={null}
        hasMore={false}
        selectCurrentPending={false}
        candidateUpdatePending={false}
        candidateCount={0}
        candidateMessage={null}
        allCurrentResultsChecked={false}
        onChangeFilters={() => undefined}
        onThumbnailSizeChange={() => undefined}
        onSelectAsset={() => undefined}
        onSetChecked={() => undefined}
        onLoadMore={() => undefined}
        onSelectCurrent={() => undefined}
        onUpdateCandidates={() => undefined}
      />,
    );

    expect(screen.getByText("筛选运行中；完成后将一次性载入首批排序结果。")).toBeTruthy();
    expect(document.querySelector("img")).toBeNull();
  });

  test("offers persistent candidate actions for accumulated cross-filter checks", async () => {
    const user = userEvent.setup();
    const updateCandidates = vi.fn();
    render(
      <ScreeningResultGallery
        projectId="project-1"
        operationId="operation-1"
        items={[item]}
        total={1}
        filters={{
          pool: "elite_candidate",
          rating: "g",
          flag: null,
          sort: "selection",
          showDuplicates: false,
        }}
        thumbnailSize={240}
        selectedAssetId={null}
        checkedAssetIds={["asset-1", "checked-in-another-rating"]}
        loading={false}
        fetching={false}
        processing={false}
        error={null}
        hasMore={false}
        selectCurrentPending={false}
        candidateUpdatePending={false}
        candidateCount={1}
        candidateMessage="候选集已更新"
        allCurrentResultsChecked
        onChangeFilters={() => undefined}
        onThumbnailSizeChange={() => undefined}
        onSelectAsset={() => undefined}
        onSetChecked={() => undefined}
        onLoadMore={() => undefined}
        onSelectCurrent={() => undefined}
        onUpdateCandidates={updateCandidates}
      />,
    );

    await user.click(screen.getByRole("button", { name: "加入候选" }));
    await user.click(screen.getByRole("button", { name: "移出候选" }));
    await user.click(screen.getByRole("button", { name: "替换候选集" }));
    await user.click(screen.getByRole("button", { name: "清空" }));
    expect(updateCandidates.mock.calls.map(([action]) => action)).toEqual([
      "add",
      "remove",
      "replace",
      "clear",
    ]);
    expect(screen.getByText("候选集已更新")).toBeTruthy();
    expect(
      screen.getByText(/已有候选会在打开项目时恢复勾选.*提交汇总当前任务全部分组/),
    ).toBeTruthy();
  });
});
