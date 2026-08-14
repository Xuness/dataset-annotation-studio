import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { afterEach, describe, expect, test, vi } from "vitest";

import { exportWorkbenchState } from "../../../src/application/exports/exportState";
import { useExportController } from "../../../src/application/exports/useExportController";
import { useWorkspaceSelectionStore } from "../../../src/shared/store/workspaceSelectionStore";

const PROJECT_ID = "export-folder-scope-project";

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity },
      mutations: { retry: false },
    },
  });
}

afterEach(() => {
  cleanup();
  exportWorkbenchState.reset(PROJECT_ID);
  useWorkspaceSelectionStore.getState().setActiveProject(null);
  vi.unstubAllGlobals();
});

describe("export folder scope", () => {
  test("uses the effective candidate folders and switches to selected asset folders", async () => {
    const folderRequests: Array<{ method: string; url: string; body?: unknown }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = new URL(String(input));
        const method = init?.method ?? "GET";
        const pathname = url.pathname;

        if (pathname === `/api/v1/workspaces/${PROJECT_ID}`) {
          return jsonResponse({
            project_id: PROJECT_ID,
            name: "范围测试",
            root_path: "D:\\datasets\\scope-test",
            exists: true,
            created_at: "2026-08-14T00:00:00Z",
            last_opened_at: "2026-08-14T00:00:00Z",
            settings: {
              recursive_scan: true,
              system_preset_id: null,
              user_prompt: "",
              json_fields: [],
              use_tags_as_context: false,
              validation_mode: "strict",
            },
            asset_count: 4,
            annotated_count: 0,
            invalid_count: 0,
          });
        }
        if (pathname.endsWith("/assets/folders/selection")) {
          folderRequests.push({
            method,
            url: url.toString(),
            body: JSON.parse(String(init?.body)),
          });
          return jsonResponse({
            items: [
              {
                path: "",
                parent_path: null,
                name: "范围测试",
                direct_asset_count: 0,
                descendant_asset_count: 1,
              },
              {
                path: "Sandrone",
                parent_path: "",
                name: "Sandrone",
                direct_asset_count: 0,
                descendant_asset_count: 1,
              },
              {
                path: "Sandrone/rating_s",
                parent_path: "Sandrone",
                name: "rating_s",
                direct_asset_count: 1,
                descendant_asset_count: 1,
              },
            ],
          });
        }
        if (pathname.endsWith("/assets/folders")) {
          folderRequests.push({ method, url: url.toString() });
          return jsonResponse({
            items: [
              {
                path: "",
                parent_path: null,
                name: "范围测试",
                direct_asset_count: 0,
                descendant_asset_count: 2,
              },
              {
                path: "Columbina",
                parent_path: "",
                name: "Columbina",
                direct_asset_count: 0,
                descendant_asset_count: 2,
              },
            ],
          });
        }
        if (pathname.endsWith("/assets/candidates")) {
          return jsonResponse({
            total_assets: 4,
            candidate_count: 2,
            effective_count: 2,
            active: true,
          });
        }
        if (pathname.endsWith("/assets")) {
          return jsonResponse({ items: [], total: 2, offset: 0, limit: 1, status_counts: {} });
        }
        if (pathname.endsWith("/exports")) return jsonResponse([]);
        throw new Error(`Unexpected request: ${method} ${url}`);
      }),
    );

    useWorkspaceSelectionStore.getState().setActiveProject(PROJECT_ID);
    useWorkspaceSelectionStore.getState().setAssetsChecked(["sandrone-1"], true);
    const queryClient = createQueryClient();
    const wrapper = ({ children }: PropsWithChildren) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(
      () =>
        useExportController({
          projectId: PROJECT_ID,
          confirm: async () => true,
          alert: async () => undefined,
        }),
      { wrapper },
    );

    await waitFor(() =>
      expect(result.current.folders.map((folder) => folder.path)).toEqual(["", "Columbina"]),
    );
    expect(folderRequests[0]).toMatchObject({ method: "GET" });
    expect(new URL(folderRequests[0].url).searchParams.get("candidate_scope")).toBe("auto");

    act(() => result.current.patchForm({ scope: "selected" }));
    await waitFor(() =>
      expect(result.current.folders.map((folder) => folder.path)).toEqual([
        "",
        "Sandrone",
        "Sandrone/rating_s",
      ]),
    );
    expect(result.current.foldersError).toBeNull();
    expect(folderRequests.at(-1)).toMatchObject({
      method: "POST",
      body: { asset_ids: ["sandrone-1"] },
    });
  });
});
