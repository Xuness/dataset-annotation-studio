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
import { AssetFolderTree } from "../../src/pages/workspace/components/AssetFolderTree";
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
        folders={[
          {
            path: "",
            parent_path: null,
            name: "dataset",
            direct_asset_count: 0,
            descendant_asset_count: 1,
          },
          {
            path: "portraits",
            parent_path: "",
            name: "portraits",
            direct_asset_count: 1,
            descendant_asset_count: 1,
          },
        ]}
        selectedFolderPath=""
        foldersLoading={false}
        recursive={false}
        hasMore={false}
        loading={false}
        loadingMore={false}
        selectAllPending={false}
        allMatchingSelected={false}
        error={null}
        bulkActionPending={false}
        onSearchChange={() => undefined}
        onStatusChange={() => undefined}
        onFolderSelect={async () => true}
        onSelect={onSelect}
        onSetChecked={onSetChecked}
        onToggleAll={() => undefined}
        onRecursiveChange={() => undefined}
        onDeleteCheckedAnnotations={() => undefined}
        onDeleteCheckedAssets={() => undefined}
        onOpenDeletionHistory={() => undefined}
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

  test("folder rows select a subtree without changing asset checkbox state", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn(async () => true);

    render(
      <AssetFolderTree
        projectId="project-a"
        selectedPath=""
        loading={false}
        folders={[
          {
            path: "",
            parent_path: null,
            name: "dataset",
            direct_asset_count: 0,
            descendant_asset_count: 2,
          },
          {
            path: "portraits",
            parent_path: "",
            name: "portraits",
            direct_asset_count: 2,
            descendant_asset_count: 2,
          },
        ]}
        onSelect={onSelect}
      />,
    );

    await user.click(screen.getByTitle("portraits"));
    expect(onSelect).toHaveBeenCalledWith("portraits");
  });
});
