import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const annotationHooks = vi.hoisted(() => ({
  useOptions: vi.fn(),
  useReview: vi.fn(),
  useDelete: vi.fn(),
  review: vi.fn(),
  remove: vi.fn(),
  refetch: vi.fn(),
}));

vi.mock("../../src/features/annotations/hooks", () => ({
  useAnnotationBatchOptions: annotationHooks.useOptions,
  useReviewAnnotations: annotationHooks.useReview,
  useDeleteAnnotations: annotationHooks.useDelete,
}));

import { AnnotationBulkActionDialog } from "../../src/pages/workspace/components/AnnotationBulkActionDialog";

const targets = [
  {
    channel: "tags",
    language: null,
    display_name: "Tags",
    active_count: 2,
    reviewable_count: 1,
    reviewed_count: 1,
    stale_count: 0,
    blocked_count: 0,
  },
  {
    channel: "description",
    language: null,
    display_name: "LLM 描述",
    active_count: 1,
    reviewable_count: 1,
    reviewed_count: 0,
    stale_count: 0,
    blocked_count: 0,
  },
  {
    channel: "translation",
    language: "zh-CN",
    translation_source_kind: "description",
    translation_producer_kind: "llm",
    display_name: "翻译 · zh-CN",
    active_count: 1,
    reviewable_count: 1,
    reviewed_count: 0,
    stale_count: 0,
    blocked_count: 0,
  },
] as const;

beforeEach(() => {
  annotationHooks.review.mockReset();
  annotationHooks.remove.mockReset();
  annotationHooks.refetch.mockReset();
  annotationHooks.review.mockResolvedValue({
    requested_count: 2,
    target_count: 2,
    reviewed_count: 2,
    already_reviewed_count: 1,
    missing_count: 1,
    blocked_count: 0,
    asset_ids: ["asset-1", "asset-2"],
  });
  annotationHooks.remove.mockResolvedValue({
    requested_count: 2,
    target_count: 1,
    deleted_count: 1,
    missing_count: 1,
    asset_ids: ["asset-1", "asset-2"],
  });
  annotationHooks.useOptions.mockReturnValue({
    data: { requested_count: 2, targets },
    isLoading: false,
    isError: false,
    error: null,
    refetch: annotationHooks.refetch,
  });
  annotationHooks.useReview.mockReturnValue({
    isPending: false,
    mutateAsync: annotationHooks.review,
  });
  annotationHooks.useDelete.mockReturnValue({
    isPending: false,
    mutateAsync: annotationHooks.remove,
  });
});

afterEach(cleanup);

describe("annotation bulk action dialog", () => {
  test("submits all selected review channels in one request", async () => {
    const user = userEvent.setup();

    render(
      <AnnotationBulkActionDialog
        projectId="project-a"
        open
        action="review"
        assetIds={["asset-1", "asset-2"]}
        blockedTarget={null}
        onClose={() => undefined}
      />,
    );

    expect(screen.queryByText("原有标注")).toBeNull();
    await user.click(screen.getByRole("checkbox", { name: /Tags/ }));
    await user.click(screen.getByRole("checkbox", { name: /^LLM 描述1 个待复核$/ }));
    await user.click(screen.getByRole("button", { name: "标记所选类别" }));

    await waitFor(() =>
      expect(annotationHooks.review).toHaveBeenCalledWith({
        assetIds: ["asset-1", "asset-2"],
        targets: [
          { channel: "tags", language: "" },
          { channel: "description", language: "" },
        ],
      }),
    );
    expect(annotationHooks.review).toHaveBeenCalledOnce();
    expect(screen.getByText(/已复核 2 个标注文档/)).not.toBeNull();
  });

  test("protects the unsaved editor target while deleting another category", async () => {
    const user = userEvent.setup();

    render(
      <AnnotationBulkActionDialog
        projectId="project-a"
        open
        action="delete"
        assetIds={["asset-1", "asset-2"]}
        blockedTarget={{ channel: "tags", language: "" }}
        onClose={() => undefined}
      />,
    );

    expect((screen.getByRole("checkbox", { name: /Tags/ }) as HTMLInputElement).disabled).toBe(
      true,
    );
    expect(screen.getByText(/有未保存修改/)).not.toBeNull();
    await user.click(screen.getByRole("checkbox", { name: /翻译.*zh-CN/ }));
    await user.click(screen.getByRole("button", { name: "删除所选类别" }));

    await waitFor(() =>
      expect(annotationHooks.remove).toHaveBeenCalledWith({
        assetIds: ["asset-1", "asset-2"],
        targets: [
          {
            channel: "translation",
            language: "zh-CN",
            translation_source_kind: "description",
            translation_producer_kind: "llm",
          },
        ],
      }),
    );
    expect(annotationHooks.remove).toHaveBeenCalledOnce();
  });
});
