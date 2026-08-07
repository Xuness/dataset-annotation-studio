import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { preprocessWorkbenchState } from "../../../../application/preprocessing/preprocessState";
import { useAssets } from "../../../../features/assets/hooks";
import { usePreparationSpaceController } from "./usePreparationSpaceController";

const { pendingQuery } = vi.hoisted(() => ({
  pendingQuery: () => ({
    data: undefined,
    error: null,
    isError: false,
    isPending: true,
  }),
}));

vi.mock("../../../../features/assets/hooks", () => ({
  useAssets: vi.fn(pendingQuery),
}));

vi.mock("../../../../features/preprocessing/hooks", () => ({
  usePreprocessOperations: vi.fn(pendingQuery),
}));

vi.mock("../../../../features/workspaces/hooks", () => ({
  useWorkspace: vi.fn(pendingQuery),
}));

const projectId = "preparation-preview-scope";

describe("preparation space controller material preview", () => {
  beforeEach(() => {
    preprocessWorkbenchState.reset(projectId);
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
    preprocessWorkbenchState.reset(projectId);
  });

  test("restores selected folders in the preparation home preview", () => {
    preprocessWorkbenchState.patch(projectId, (current) => ({
      form: { ...current.form, scope: "folder", folderPaths: ["2024", "2025"] },
    }));
    const options = {
      projectId,
      onOpenArchive: vi.fn(),
      onOpenWorkbench: vi.fn(),
      onOpenOperation: vi.fn(),
    };

    const firstVisit = renderHook(() => usePreparationSpaceController(options));
    expect(useAssets).toHaveBeenLastCalledWith(projectId, {
      folderPaths: ["2024", "2025"],
      limit: 6,
    });
    firstVisit.unmount();

    renderHook(() => usePreparationSpaceController(options));
    expect(useAssets).toHaveBeenLastCalledWith(projectId, {
      folderPaths: ["2024", "2025"],
      limit: 6,
    });
  });
});
