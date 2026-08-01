import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, test, vi } from "vitest";

import { NewJobPanel } from "../../pages/jobs/components/NewJobPanel";
import type { WorkspaceSummary } from "../../../src/shared/api/types";

function createQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
}

function jsonResponse(data: unknown) {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

const workspace: WorkspaceSummary = {
  project_id: "project-1",
  name: "测试项目",
  root_path: "D:\\datasets\\test",
  exists: true,
  created_at: "2026-07-25T08:00:00Z",
  last_opened_at: "2026-07-25T08:00:00Z",
  settings: {
    recursive_scan: true,
    system_preset_id: null,
    user_prompt: "",
    json_fields: [],
    use_tags_as_context: false,
    validation_mode: "strict",
  },
  asset_count: 12,
  annotated_count: 0,
  invalid_count: 0,
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("new local tagger job summary", () => {
  test("shows effective category thresholds, output categories, device and batch size", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        if (
          url.endsWith("/api/v1/presets/system") ||
          url.endsWith("/api/v1/presets/translation-prompts") ||
          url.endsWith("/api/v1/presets/providers")
        ) {
          return jsonResponse([]);
        }
        if (url.endsWith("/api/v1/taggers")) {
          return jsonResponse({
            model_root: "D:\\models\\taggers",
            disk_size: 1,
            installations: [],
            profiles: [
              {
                id: "profile-1",
                name: "CL Tagger 分类配置",
                installation_id: "installation-1",
                selection: {
                  mode: "category",
                  global_threshold: 0.35,
                  category_thresholds: {
                    character: 0.85,
                  },
                  max_tags: null,
                },
                categories: ["general", "character"],
                device: "cuda",
                concurrency: 1,
                batch_size: null,
                installation_name: "CL Tagger v2.01a",
                model_version: "v2.01a",
                ready: true,
                issue: null,
                created_at: "2026-07-25T08:00:00Z",
                updated_at: "2026-07-25T08:00:00Z",
              },
            ],
            runtime: {
              available: true,
              providers: ["CUDAExecutionProvider"],
              devices: ["auto", "cpu", "cuda"],
              error: null,
            },
            supported_adapters: [],
            scan_issues: [],
          });
        }
        throw new Error(`Unexpected request: ${url}`);
      }),
    );
    const user = userEvent.setup();

    render(
      <QueryClientProvider client={createQueryClient()}>
        <MemoryRouter>
          <NewJobPanel
            projectId="project-1"
            workspace={workspace}
            checkedAssetIds={[]}
            onCreated={() => undefined}
          />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    await user.click(screen.getByRole("button", { name: "本地打标器" }));

    expect(await screen.findByText("CL Tagger 分类配置")).toBeTruthy();
    expect(screen.getByText("有效分类阈值")).toBeTruthy();
    expect(screen.getByText("通用 0.35 · 角色 0.85")).toBeTruthy();
    expect(screen.getByText("通用、角色")).toBeTruthy();
    expect(screen.getByText("NVIDIA CUDA · 自动批次")).toBeTruthy();
  });
});
