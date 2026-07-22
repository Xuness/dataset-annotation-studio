import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, test, vi } from "vitest";

vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getTotalSize: () => count * 72,
    getVirtualItems: () =>
      Array.from({ length: count }, (_, index) => ({ index, start: index * 72 })),
    scrollToIndex: vi.fn(),
  }),
}));

import { AssetBrowser } from "../../src/pages/workspace/components/AssetBrowser";
import type { AssetSummary } from "../../src/shared/api/types";

const asset: AssetSummary = {
  id: "asset-1",
  relative_path: "portraits/sample.png",
  filename: "sample.png",
  suffix: ".png",
  content_version: "v1",
  byte_size: 4096,
  width: 512,
  height: 768,
  annotation_relative_path: "portraits/sample.txt",
  annotation_status: "valid",
  metadata_relative_path: null,
  generation_status: null,
  generation_error: null,
};

afterEach(cleanup);

describe("asset browser rows", () => {
  test("keeps selection and opening as independent accessible controls", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn(async () => true);
    const onSetChecked = vi.fn();

    render(
      <AssetBrowser
        projectId="project-a"
        assets={[asset]}
        total={1}
        selectedAssetId={null}
        checkedAssetIds={[]}
        search=""
        statusFilter={null}
        statusCounts={{}}
        recursive={false}
        hasMore={false}
        loading={false}
        loadingMore={false}
        selectAllPending={false}
        allMatchingSelected={false}
        error={null}
        onSearchChange={() => undefined}
        onStatusChange={() => undefined}
        onSelect={onSelect}
        onSetChecked={onSetChecked}
        onToggleAll={() => undefined}
        onRecursiveChange={() => undefined}
        onLoadMore={() => undefined}
      />,
    );

    const checkbox = screen.getByRole("checkbox", { name: "选择 sample.png" });
    const openButton = screen.getByRole("button", { name: /sample\.png/ });
    expect(openButton.contains(checkbox)).toBe(false);

    await user.click(checkbox);
    expect(onSetChecked).toHaveBeenCalledWith(["asset-1"], true);
    expect(onSelect).not.toHaveBeenCalled();

    await user.click(openButton);
    expect(onSelect).toHaveBeenCalledWith("asset-1");
  });
});
