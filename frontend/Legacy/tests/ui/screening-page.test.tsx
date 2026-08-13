import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, describe, expect, test, vi } from "vitest";

vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getTotalSize: () => count * 224,
    getVirtualItems: () =>
      Array.from({ length: count }, (_, index) => ({ index, start: index * 224 })),
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
    const setChecked = vi.fn();
    const selectCurrent = vi.fn();

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
        density="comfortable"
        selectedAssetId={null}
        checkedAssetIds={[]}
        loading={false}
        fetching={false}
        processing={false}
        error={null}
        hasMore={false}
        selectCurrentPending={false}
        onChangeFilters={changeFilters}
        onDensityChange={() => undefined}
        onSelectAsset={() => undefined}
        onSetChecked={setChecked}
        onLoadMore={() => undefined}
        onSelectCurrent={selectCurrent}
      />,
    );

    expect(screen.getByText("hero.png")).toBeTruthy();
    expect(screen.getByText("任务百分位 99.0% · #1")).toBeTruthy();
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
        density="comfortable"
        selectedAssetId={null}
        checkedAssetIds={[]}
        loading={false}
        fetching={false}
        processing
        error={null}
        hasMore={false}
        selectCurrentPending={false}
        onChangeFilters={() => undefined}
        onDensityChange={() => undefined}
        onSelectAsset={() => undefined}
        onSetChecked={() => undefined}
        onLoadMore={() => undefined}
        onSelectCurrent={() => undefined}
      />,
    );

    expect(screen.getByText("筛选运行中；完成后将一次性载入首批排序结果。")).toBeTruthy();
    expect(document.querySelector("img")).toBeNull();
  });
});
