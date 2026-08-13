import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { afterEach, describe, expect, test, vi } from "vitest";

import { useCandidateSelectionHydration } from "../../../src/application/workspace/useCandidateSelectionHydration";
import { useWorkspaceSelectionStore } from "../../../src/shared/store/workspaceSelectionStore";

function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
}

afterEach(() => {
  cleanup();
  useWorkspaceSelectionStore.getState().setActiveProject(null);
  vi.unstubAllGlobals();
});

describe("candidate checkbox hydration", () => {
  test("merges persisted candidates once per workspace visit without forcing later checkbox edits", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ ids: ["persisted-a", "persisted-b"], total: 2 }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
      ),
    );
    useWorkspaceSelectionStore.getState().setActiveProject("project-1");
    useWorkspaceSelectionStore.getState().setAssetsChecked(["manual-draft"], true);

    const queryClient = createQueryClient();
    const wrapper = ({ children }: PropsWithChildren) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    const { rerender } = renderHook(
      ({ projectId }: { projectId: string | null }) => useCandidateSelectionHydration(projectId),
      { initialProps: { projectId: "project-1" }, wrapper },
    );

    await waitFor(() =>
      expect(useWorkspaceSelectionStore.getState().checkedAssetIds).toEqual([
        "manual-draft",
        "persisted-a",
        "persisted-b",
      ]),
    );

    act(() => useWorkspaceSelectionStore.getState().setAssetsChecked(["persisted-a"], false));
    rerender({ projectId: "project-1" });
    expect(useWorkspaceSelectionStore.getState().checkedAssetIds).toEqual([
      "manual-draft",
      "persisted-b",
    ]);

    rerender({ projectId: null });
    rerender({ projectId: "project-1" });
    await waitFor(() =>
      expect(useWorkspaceSelectionStore.getState().checkedAssetIds).toEqual([
        "manual-draft",
        "persisted-b",
        "persisted-a",
      ]),
    );
  });
});
