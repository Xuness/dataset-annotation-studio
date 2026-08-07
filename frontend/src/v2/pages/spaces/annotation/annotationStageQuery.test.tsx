import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, test, vi } from "vitest";

import { listAssets } from "../../../../features/assets/api";
import { useInfiniteAssets } from "../../../../features/assets/hooks";
import type { AssetListResponse } from "../../../../shared/api/types";

vi.mock("../../../../features/assets/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../features/assets/api")>();
  return { ...actual, listAssets: vi.fn() };
});

function response(total: number): AssetListResponse {
  return { items: [], limit: 120, offset: 0, status_counts: {}, total };
}

describe("annotation stage material scope query", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  test("keeps the current project frame while a changed material scope is fetched", async () => {
    let resolveChangedScope: ((value: AssetListResponse) => void) | undefined;
    vi.mocked(listAssets).mockImplementation((_projectId, query) => {
      if (query.folderPaths?.includes("set-b")) {
        return new Promise((resolve) => {
          resolveChangedScope = resolve;
        });
      }
      return Promise.resolve(response(8));
    });

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const { result, rerender } = renderHook(
      ({ folderPaths }: { folderPaths: string[] }) =>
        useInfiniteAssets("project-1", { folderPaths }, 120, { keepPreviousData: true }),
      { wrapper, initialProps: { folderPaths: ["set-a"] } },
    );

    await waitFor(() => expect(result.current.data?.pages[0]?.total).toBe(8));
    rerender({ folderPaths: ["set-b"] });

    expect(result.current.isPending).toBe(false);
    expect(result.current.isPlaceholderData).toBe(true);
    expect(result.current.data?.pages[0]?.total).toBe(8);

    act(() => resolveChangedScope?.(response(13)));
    await waitFor(() => expect(result.current.data?.pages[0]?.total).toBe(13));
    expect(result.current.isPlaceholderData).toBe(false);
  });
});
