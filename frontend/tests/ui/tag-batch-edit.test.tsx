import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const batchHooks = vi.hoisted(() => ({
  previewHook: vi.fn(),
  executeHook: vi.fn(),
  preview: vi.fn(),
  execute: vi.fn(),
  resetPreview: vi.fn(),
  resetExecute: vi.fn(),
}));

const statisticsHooks = vi.hoisted(() => ({
  tagFrequency: vi.fn(),
}));

vi.mock("../../src/features/annotations/hooks", () => ({
  usePreviewTagBatchEdit: batchHooks.previewHook,
  useExecuteTagBatchEdit: batchHooks.executeHook,
}));

vi.mock("../../src/features/taggers/hooks", () => ({
  useTaggerLibrary: vi.fn(() => ({ data: { installations: [] } })),
  useTaggerVocabularySearch: vi.fn(() => ({ data: undefined, isFetching: false })),
}));

vi.mock("../../src/features/tagDictionaries/hooks", () => ({
  useTagDictionarySearch: vi.fn(() => ({ data: undefined, isFetching: false })),
}));

vi.mock("../../src/features/statistics/hooks", () => ({
  useTagFrequency: statisticsHooks.tagFrequency,
}));

import { TagBatchEditDialog } from "../../src/pages/workspace/components/TagBatchEditDialog";
import { parseBatchTagDraft } from "../../src/pages/workspace/components/tagBatchEditState";

const summary = {
  requested_count: 2,
  changed_count: 2,
  unchanged_count: 0,
  created_or_revived_count: 1,
  emptied_count: 0,
  stale_rebound_count: 1,
  invalidated_tag_translation_count: 2,
  position_skipped_count: 0,
  position_clamped_count: 0,
  terms: [
    {
      name: "blue_hair",
      present_before_count: 1,
      added_count: 1,
      removed_count: 0,
    },
  ],
};

const previewDetails = {
  filter: "changed" as const,
  offset: 0,
  limit: 20,
  total: 2,
  items: [
    {
      asset_id: "asset-1",
      filename: "first.png",
      relative_path: "folder/first.png",
      content_version: "hash-1",
      changed: true,
      position_skipped: false,
      position_clamped: false,
      before_tags: [
        { name: "general_first", category: "general", confidence: 0.8, origin: "tagger" },
        { name: "character_second", category: "character", confidence: null, origin: "manual" },
        { name: "removed_third", category: "quality", confidence: null, origin: "manual" },
      ],
      after_tags: [
        { name: "general_first", category: "general", confidence: 0.8, origin: "tagger" },
        { name: "inserted_second", category: "artist", confidence: null, origin: "manual" },
        { name: "character_second", category: "character", confidence: null, origin: "manual" },
      ],
      removed_indices: [2],
      added_indices: [1],
    },
    {
      asset_id: "asset-2",
      filename: "second.png",
      relative_path: "folder/second.png",
      content_version: "hash-2",
      changed: true,
      position_skipped: false,
      position_clamped: true,
      before_tags: [],
      after_tags: [{ name: "inserted_second", category: null, confidence: null, origin: "manual" }],
      removed_indices: [],
      added_indices: [0],
    },
  ],
};

const previewSummary = {
  ...summary,
  preview_token: "a".repeat(64),
  details: previewDetails,
};

const resultSummary = {
  ...summary,
  changed_asset_ids: ["asset-1", "asset-2"],
};

beforeEach(() => {
  batchHooks.preview.mockReset();
  batchHooks.execute.mockReset();
  batchHooks.resetPreview.mockReset();
  batchHooks.resetExecute.mockReset();
  batchHooks.preview.mockResolvedValue(previewSummary);
  batchHooks.execute.mockResolvedValue(resultSummary);
  batchHooks.previewHook.mockReturnValue({
    isPending: false,
    mutateAsync: batchHooks.preview,
    reset: batchHooks.resetPreview,
  });
  batchHooks.executeHook.mockReturnValue({
    isPending: false,
    mutateAsync: batchHooks.execute,
    reset: batchHooks.resetExecute,
  });
  statisticsHooks.tagFrequency.mockReturnValue({ data: { buckets: [] } });
});

afterEach(cleanup);

describe("batch Tags editing", () => {
  test("parses CSV quoting and preserves first-seen values", () => {
    expect(parseBatchTagDraft('"red, eyes", blue\n"two ""quotes"""')).toEqual([
      "red, eyes",
      "blue",
      'two "quotes"',
    ]);
  });

  test("previews CSV additions and executes only after a changed preview", async () => {
    const user = userEvent.setup();
    render(
      <TagBatchEditDialog
        projectId="project-a"
        open
        assetIds={["asset-1", "asset-2"]}
        blockedTagDraft={false}
        onClose={() => undefined}
      />,
    );

    await user.type(
      screen.getByRole("textbox", { name: "要添加的 Tags" }),
      'blue_hair,\n"red, eyes"',
    );
    await user.click(screen.getByRole("button", { name: "预览变更" }));
    await waitFor(() =>
      expect(batchHooks.preview).toHaveBeenCalledWith({
        request: {
          asset_ids: ["asset-1", "asset-2"],
          operation: {
            kind: "add",
            tags: [
              { name: "blue_hair", category: null },
              { name: "red, eyes", category: null },
            ],
            position: { kind: "end" },
          },
        },
        options: { detailFilter: "changed", detailOffset: 0, detailLimit: 20 },
      }),
    );
    expect(screen.getByText("重新绑定过期 Tags")).not.toBeNull();
    expect(screen.getByText("失配的 Tags 译文")).not.toBeNull();

    await user.click(screen.getByRole("button", { name: "执行修改" }));
    await waitFor(() =>
      expect(batchHooks.execute).toHaveBeenCalledWith({
        asset_ids: ["asset-1", "asset-2"],
        operation: {
          kind: "add",
          tags: [
            { name: "blue_hair", category: null },
            { name: "red, eyes", category: null },
          ],
          position: { kind: "end" },
        },
        preview_token: "a".repeat(64),
      }),
    );
    expect(screen.getByText(/素材勾选范围保持不变/)).not.toBeNull();
    expect(
      (screen.getByRole("textbox", { name: "要添加的 Tags" }) as HTMLTextAreaElement).value,
    ).toBe("");
  });

  test("supports start and one-based index positions and invalidates the old preview", async () => {
    const user = userEvent.setup();
    render(
      <TagBatchEditDialog
        projectId="project-a"
        open
        assetIds={["asset-1", "asset-2"]}
        blockedTagDraft={false}
        onClose={() => undefined}
      />,
    );

    await user.type(screen.getByRole("textbox", { name: "要添加的 Tags" }), "new_tag");
    await user.selectOptions(screen.getByRole("combobox", { name: "插入位置" }), "start");
    await user.click(screen.getByRole("button", { name: "预览变更" }));
    await waitFor(() => expect(batchHooks.preview).toHaveBeenCalledTimes(1));
    expect(batchHooks.preview.mock.calls[0][0].request.operation.position).toEqual({
      kind: "start",
    });
    expect(screen.getAllByText("定位跳过").length).toBeGreaterThan(0);
    expect(screen.getAllByText("夹到末尾").length).toBeGreaterThan(0);

    await user.selectOptions(screen.getByRole("combobox", { name: "插入位置" }), "index");
    expect(screen.queryByText("预览")).toBeNull();
    const indexInput = screen.getByRole("spinbutton", { name: "目标序号" });
    await user.clear(indexInput);
    expect(screen.getByRole("button", { name: "预览变更" })).toHaveProperty("disabled", true);
    expect(screen.getByText(/第 N 位必须/)).not.toBeNull();
    await user.type(indexInput, "3");
    await user.click(screen.getByRole("button", { name: "预览变更" }));
    await waitFor(() => expect(batchHooks.preview).toHaveBeenCalledTimes(2));
    expect(batchHooks.preview.mock.calls[1][0].request.operation.position).toEqual({
      kind: "index",
      index: 2,
    });
    await user.click(screen.getByRole("button", { name: "执行修改" }));
    await waitFor(() => expect(batchHooks.execute).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("combobox", { name: "插入位置" })).toHaveProperty("value", "end");
  });

  test("uses project Tag frequency suggestions for before and after anchors", async () => {
    statisticsHooks.tagFrequency.mockReturnValue({
      data: {
        buckets: [
          { value: "anchor_tag", count: 7, share: 0.7 },
          { value: "other_tag", count: 3, share: 0.3 },
        ],
      },
    });
    const user = userEvent.setup();
    render(
      <TagBatchEditDialog
        projectId="project-a"
        open
        assetIds={["asset-1"]}
        blockedTagDraft={false}
        onClose={() => undefined}
      />,
    );

    await user.type(screen.getByRole("textbox", { name: "要添加的 Tags" }), "new_tag");
    await user.selectOptions(screen.getByRole("combobox", { name: "插入位置" }), "before");
    expect(screen.getByRole("button", { name: "预览变更" })).toHaveProperty("disabled", true);
    expect(screen.getByText("请输入用于定位的 Tag。")).not.toBeNull();
    const anchorInput = screen.getByRole("textbox", { name: "定位 Tag" });
    await user.click(anchorInput);
    await user.click(screen.getByRole("option", { name: /anchor_tag.*7 次/ }));
    await user.click(screen.getByRole("button", { name: "预览变更" }));
    await waitFor(() => expect(batchHooks.preview).toHaveBeenCalledTimes(1));
    expect(batchHooks.preview.mock.calls[0][0].request.operation.position).toEqual({
      kind: "before",
      anchor_name: "anchor_tag",
    });

    await user.selectOptions(screen.getByRole("combobox", { name: "插入位置" }), "after");
    expect(screen.queryByText("预览")).toBeNull();
    await user.click(screen.getByRole("button", { name: "预览变更" }));
    await waitFor(() => expect(batchHooks.preview).toHaveBeenCalledTimes(2));
    expect(batchHooks.preview.mock.calls[1][0].request.operation.position).toEqual({
      kind: "after",
      anchor_name: "anchor_tag",
    });
  });

  test("supports replace mode and blocks execution for an unsaved Tags draft", async () => {
    const user = userEvent.setup();
    render(
      <TagBatchEditDialog
        projectId="project-a"
        open
        assetIds={["asset-1"]}
        blockedTagDraft
        onClose={() => undefined}
      />,
    );

    await user.click(screen.getByRole("button", { name: "替换" }));
    await user.type(screen.getByRole("textbox", { name: "旧 Tag" }), "old_tag");
    await user.type(screen.getByRole("textbox", { name: "新 Tag" }), "new_tag");
    await user.click(screen.getByRole("button", { name: "预览变更" }));
    await waitFor(() => expect(batchHooks.preview).toHaveBeenCalled());
    expect(batchHooks.preview.mock.calls[0][0].request.operation).toEqual({
      kind: "replace",
      source_name: "old_tag",
      replacement: { name: "new_tag", category: null },
    });
    expect(screen.getByText(/有未保存修改/)).not.toBeNull();
    expect(screen.getByRole("button", { name: "执行修改" })).toHaveProperty("disabled", true);
    expect(batchHooks.execute).not.toHaveBeenCalled();
  });

  test("invalidates a preview when switching to deletion and disables no-op execution", async () => {
    const user = userEvent.setup();
    batchHooks.preview.mockResolvedValueOnce({
      ...previewSummary,
      changed_count: 0,
      unchanged_count: 2,
    });
    render(
      <TagBatchEditDialog
        projectId="project-a"
        open
        assetIds={["asset-1", "asset-2"]}
        blockedTagDraft={false}
        onClose={() => undefined}
      />,
    );
    await user.type(screen.getByRole("textbox", { name: "要添加的 Tags" }), "already_there");
    await user.click(screen.getByRole("button", { name: "预览变更" }));
    await waitFor(() => expect(screen.getByText("预览")).not.toBeNull());
    expect(screen.getByRole("button", { name: "执行修改" })).toHaveProperty("disabled", true);

    await user.click(screen.getByRole("button", { name: "删除" }));
    expect(screen.queryByText("预览")).toBeNull();
    await user.type(screen.getByRole("textbox", { name: "要删除的 Tags" }), "old_tag");
    await user.click(screen.getByRole("button", { name: "预览变更" }));
    await waitFor(() => expect(batchHooks.preview).toHaveBeenCalledTimes(2));
    expect(screen.getByRole("button", { name: "执行删除" })).toHaveProperty("disabled", false);
  });

  test("offers retry after a preview failure", async () => {
    const user = userEvent.setup();
    batchHooks.preview.mockRejectedValueOnce(new Error("网络暂时不可用"));
    render(
      <TagBatchEditDialog
        projectId="project-a"
        open
        assetIds={["asset-1"]}
        blockedTagDraft={false}
        onClose={() => undefined}
      />,
    );
    await user.type(screen.getByRole("textbox", { name: "要添加的 Tags" }), "new_tag");
    await user.click(screen.getByRole("button", { name: "预览变更" }));
    await waitFor(() => expect(screen.getByText("网络暂时不可用")).not.toBeNull());
    await user.click(screen.getByRole("button", { name: "重试" }));
    await waitFor(() => expect(batchHooks.preview).toHaveBeenCalledTimes(2));
  });

  test("renders complete before and after Tags in raw order with exact highlights", async () => {
    const user = userEvent.setup();
    render(
      <TagBatchEditDialog
        projectId="project-a"
        open
        assetIds={["asset-1", "asset-2"]}
        blockedTagDraft={false}
        onClose={() => undefined}
      />,
    );

    await user.type(screen.getByRole("textbox", { name: "要添加的 Tags" }), "inserted_second");
    await user.click(screen.getByRole("button", { name: "预览变更" }));

    const before = await screen.findByRole("region", { name: "修改前 Tags 顺序" });
    const after = screen.getByRole("region", { name: "修改后 Tags 顺序" });
    const beforeItems = within(before).getAllByRole("listitem");
    const afterItems = within(after).getAllByRole("listitem");
    expect(beforeItems.map((item) => item.querySelector("code")?.textContent)).toEqual([
      "general_first",
      "character_second",
      "removed_third",
    ]);
    expect(afterItems.map((item) => item.querySelector("code")?.textContent)).toEqual([
      "general_first",
      "inserted_second",
      "character_second",
    ]);
    expect(beforeItems.map((item) => item.querySelector("span")?.textContent)).toEqual([
      "1",
      "2",
      "3",
    ]);
    expect(beforeItems[2]).toHaveProperty("className", "is-removed");
    expect(afterItems[1]).toHaveProperty("className", "is-added");
    expect(afterItems[1].getAttribute("title")).toContain("artist");
  });

  test("filters and paginates actual-order details without changing the edit request", async () => {
    const user = userEvent.setup();
    const changedPage = {
      ...previewSummary,
      requested_count: 22,
      changed_count: 21,
      unchanged_count: 1,
      details: { ...previewDetails, total: 21, items: previewDetails.items.slice(0, 1) },
    };
    const allFirstPage = {
      ...changedPage,
      details: {
        ...previewDetails,
        filter: "all" as const,
        total: 22,
        items: previewDetails.items.slice(0, 1),
      },
    };
    const allSecondPage = {
      ...allFirstPage,
      details: {
        ...allFirstPage.details,
        offset: 20,
        items: previewDetails.items.slice(1),
      },
    };
    batchHooks.preview
      .mockResolvedValueOnce(changedPage)
      .mockResolvedValueOnce(allFirstPage)
      .mockResolvedValueOnce(allSecondPage);
    render(
      <TagBatchEditDialog
        projectId="project-a"
        open
        assetIds={["asset-1", "asset-2"]}
        blockedTagDraft={false}
        onClose={() => undefined}
      />,
    );

    await user.type(screen.getByRole("textbox", { name: "要添加的 Tags" }), "new_tag");
    await user.click(screen.getByRole("button", { name: "预览变更" }));
    await screen.findByText("1–1 / 21");
    await user.click(screen.getByRole("button", { name: "全部 22" }));
    await waitFor(() => expect(batchHooks.preview).toHaveBeenCalledTimes(2));
    expect(batchHooks.preview.mock.calls[1][0].options).toEqual({
      detailFilter: "all",
      detailOffset: 0,
      detailLimit: 20,
    });

    await user.click(screen.getByRole("button", { name: "下一页" }));
    await waitFor(() => expect(batchHooks.preview).toHaveBeenCalledTimes(3));
    expect(batchHooks.preview.mock.calls[2][0].options).toEqual({
      detailFilter: "all",
      detailOffset: 20,
      detailLimit: 20,
    });
    expect(batchHooks.preview.mock.calls[2][0].request.operation).toEqual(
      batchHooks.preview.mock.calls[0][0].request.operation,
    );
    expect(await screen.findByText("21–21 / 22")).not.toBeNull();
  });

  test("keeps a valid preview when detail paging fails and retries the failed page", async () => {
    const user = userEvent.setup();
    const firstPage = {
      ...previewSummary,
      requested_count: 21,
      changed_count: 21,
      details: { ...previewDetails, total: 21, items: previewDetails.items.slice(0, 1) },
    };
    const lastPage = {
      ...firstPage,
      details: { ...firstPage.details, offset: 20, items: previewDetails.items.slice(1) },
    };
    batchHooks.preview
      .mockResolvedValueOnce(firstPage)
      .mockRejectedValueOnce(new Error("明细网络失败"))
      .mockResolvedValueOnce(lastPage);
    render(
      <TagBatchEditDialog
        projectId="project-a"
        open
        assetIds={["asset-1", "asset-2"]}
        blockedTagDraft={false}
        onClose={() => undefined}
      />,
    );

    await user.type(screen.getByRole("textbox", { name: "要添加的 Tags" }), "new_tag");
    await user.click(screen.getByRole("button", { name: "预览变更" }));
    await screen.findByText("1–1 / 21");
    await user.click(screen.getByRole("button", { name: "下一页" }));
    expect(await screen.findByText("明细网络失败")).not.toBeNull();
    expect(screen.getByText("first.png")).not.toBeNull();
    expect(screen.getByRole("button", { name: "执行修改" })).toHaveProperty("disabled", false);

    await user.click(screen.getByRole("button", { name: "重试" }));
    await waitFor(() => expect(batchHooks.preview).toHaveBeenCalledTimes(3));
    expect(batchHooks.preview.mock.calls[2][0].options.detailOffset).toBe(20);
    expect(await screen.findByText("21–21 / 21")).not.toBeNull();
  });
});
