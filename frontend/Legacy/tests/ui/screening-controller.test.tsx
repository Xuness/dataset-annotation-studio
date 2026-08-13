import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { afterEach, describe, expect, test, vi } from "vitest";

import { screeningWorkbenchState } from "../../../src/application/screening/screeningState";
import { useScreeningController } from "../../../src/application/screening/useScreeningController";
import { useWorkspaceSelectionStore } from "../../../src/shared/store/workspaceSelectionStore";

const PROJECT_ID = "candidate-handoff-project";
const OPERATION_ID = "candidate-handoff-operation";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
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
  screeningWorkbenchState.reset(PROJECT_ID);
  useWorkspaceSelectionStore.getState().setActiveProject(null);
  vi.unstubAllGlobals();
});

describe("screening candidate handoff", () => {
  test("submits accumulated cross-filter checks and preserves checkbox state", async () => {
    const submittedBodies: unknown[] = [];
    const candidateScopeUrls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = new URL(String(input));
        const method = init?.method ?? "GET";
        const pathname = url.pathname;

        if (pathname === `/api/v1/workspaces/${PROJECT_ID}`) {
          return jsonResponse({
            project_id: PROJECT_ID,
            name: "候选交接测试",
            root_path: "D:\\datasets\\candidate-handoff",
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
            asset_count: 6,
            annotated_count: 0,
            invalid_count: 0,
          });
        }
        if (pathname.endsWith("/assets/folders")) return jsonResponse({ items: [] });
        if (pathname.endsWith("/assets/ids")) {
          return jsonResponse({ ids: ["g-elite", "s-review", "q-recommended"], total: 3 });
        }
        if (pathname.endsWith("/assets/candidates") && method === "PATCH") {
          submittedBodies.push(JSON.parse(String(init?.body)));
          return jsonResponse({
            total_assets: 6,
            candidate_count: 3,
            effective_count: 3,
            active: true,
          });
        }
        if (pathname.endsWith("/assets/candidates")) {
          return jsonResponse({
            total_assets: 6,
            candidate_count: 0,
            effective_count: 6,
            active: false,
          });
        }
        if (pathname.endsWith("/assets")) {
          return jsonResponse({ items: [], total: 6, offset: 0, limit: 1, status_counts: {} });
        }
        if (pathname.endsWith("/screening/capabilities")) {
          return jsonResponse({
            score_mode: "batch_only_v0_1",
            score_version: "metarank_batch_v0.1",
            max_assets_per_operation: 100_000,
            task_profiles: ["character_lora"],
            task_profile_versions: { character_lora: "character_lora_v1" },
            selection_policy_version: "screening_selection_v1",
            intensities: ["balanced"],
            candidate_pools: [],
            batch_local_only: true,
            reads_global_archive: false,
            modifies_assets: false,
            enabled_signals: [],
            disabled_signals: [],
          });
        }
        if (pathname.endsWith("/screening/operations")) {
          return jsonResponse([
            {
              id: OPERATION_ID,
              status: "completed",
              score_mode: "batch_only_v0_1",
              score_version: "metarank_batch_v0.1",
              total_items: 6,
              processed_items: 6,
              scored_items: 6,
              invalid_items: 0,
              current_relative_path: null,
              configuration_snapshot: {},
              task_profile_snapshot: null,
              task_evaluated_items: 6,
              task_unavailable_items: 0,
              task_profile_updated_at: null,
              pool_counts: {},
              rating_counts: {},
              created_at: "2026-08-14T00:00:00Z",
              updated_at: "2026-08-14T00:00:01Z",
              started_at: "2026-08-14T00:00:00Z",
              completed_at: "2026-08-14T00:00:01Z",
              error_message: null,
            },
          ]);
        }
        if (pathname.endsWith(`/screening/operations/${OPERATION_ID}/asset-ids`)) {
          candidateScopeUrls.push(url.toString());
          return jsonResponse({ ids: ["g-elite", "s-review", "q-recommended"], total: 3 });
        }
        if (pathname.endsWith(`/screening/operations/${OPERATION_ID}/items`)) {
          return jsonResponse({ items: [], total: 0, offset: 0, limit: 240 });
        }
        throw new Error(`Unexpected request: ${method} ${url}`);
      }),
    );

    screeningWorkbenchState.patch(PROJECT_ID, (current) => ({
      selectedOperationId: OPERATION_ID,
      filters: {
        ...current.filters,
        pool: "elite_candidate",
        rating: "g",
        showDuplicates: false,
      },
    }));
    useWorkspaceSelectionStore.getState().setActiveProject(PROJECT_ID);
    useWorkspaceSelectionStore
      .getState()
      .setAssetsChecked(
        ["g-elite", "s-review", "q-recommended", "hidden-duplicate", "other-operation"],
        true,
      );

    const queryClient = createQueryClient();
    const wrapper = ({ children }: PropsWithChildren) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(
      () =>
        useScreeningController({
          projectId: PROJECT_ID,
          rescanPending: false,
          confirm: async () => true,
        }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.resultsReady).toBe(true));
    await act(async () => result.current.updateCandidateSet("add"));

    expect(candidateScopeUrls).toHaveLength(1);
    const candidateScope = new URL(candidateScopeUrls[0]);
    expect(candidateScope.searchParams.get("pool")).toBeNull();
    expect(candidateScope.searchParams.get("rating")).toBeNull();
    expect(candidateScope.searchParams.get("low_resolution")).toBeNull();
    expect(candidateScope.searchParams.get("show_duplicates")).toBe("false");
    expect(submittedBodies).toEqual([
      {
        action: "add",
        asset_ids: ["g-elite", "s-review", "q-recommended"],
        source_kind: "screening",
        source_operation_id: OPERATION_ID,
      },
    ]);
    expect(useWorkspaceSelectionStore.getState().checkedAssetIds).toEqual([
      "g-elite",
      "s-review",
      "q-recommended",
      "hidden-duplicate",
      "other-operation",
    ]);
    expect(result.current.candidateMessage).toMatch(/累计勾选已保留/);
  });
});
