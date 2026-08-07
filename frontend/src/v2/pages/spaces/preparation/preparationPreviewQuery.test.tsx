import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, test, vi } from "vitest";

import { listAssets } from "../../../../features/assets/api";
import { useAssets } from "../../../../features/assets/hooks";
import type { AssetListResponse } from "../../../../shared/api/types";

vi.mock("../../../../features/assets/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../features/assets/api")>();
  return { ...actual, listAssets: vi.fn() };
});

function response(total: number): AssetListResponse {
  return { items: [], limit: 5, offset: 0, status_counts: {}, total };
}

describe("preparation material preview query", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  test("keeps the previous thumbnails while a changed folder preview is fetched", async () => {
    let resolveChangedScope: ((value: AssetListResponse) => void) | undefined;
    vi.mocked(listAssets).mockImplementation((_projectId, query) => {
      if (query.folderPaths?.includes("2025")) {
        return new Promise((resolve) => {
          resolveChangedScope = resolve;
        });
      }
      return Promise.resolve(response(32));
    });

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const { result, rerender } = renderHook(
      ({ folderPaths }: { folderPaths: string[] }) =>
        useAssets("project-1", { folderPaths, limit: 5 }, { keepPreviousData: true }),
      { wrapper, initialProps: { folderPaths: ["2024"] } },
    );

    await waitFor(() => expect(result.current.data?.total).toBe(32));
    rerender({ folderPaths: ["2025"] });

    expect(result.current.isPending).toBe(false);
    expect(result.current.isPlaceholderData).toBe(true);
    expect(result.current.data?.total).toBe(32);

    act(() => resolveChangedScope?.(response(29)));
    await waitFor(() => expect(result.current.data?.total).toBe(29));
    expect(result.current.isPlaceholderData).toBe(false);
  });
});
