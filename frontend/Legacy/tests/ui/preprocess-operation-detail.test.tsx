import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, test, vi } from "vitest";

import { PreprocessHistoryPanel } from "../../pages/preprocess/components/PreprocessHistoryPanel";
import { PreprocessOperationDetailPanel } from "../../pages/preprocess/components/PreprocessOperationDetailPanel";
import { PreprocessPage } from "../../pages/preprocess/PreprocessPage";
import type { PreprocessOperation } from "../../../src/shared/api/types";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

function jsonResponse(data: unknown) {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

const runningOperation: PreprocessOperation = {
  id: "operation-running",
  status: "running",
  item_count: 10,
  completed_items: 4,
  eta_seconds: 30,
  current_relative_path: "processed/image_000004.webp",
  options: {
    asset_ids: [],
    resize: {
      max_edge: 1536,
      allow_upscale: false,
      algorithm: "anime_low_halo",
    },
    convert: {
      format: "webp",
      quality: 92,
      effort: 5,
    },
    rename: {
      template: "image_{index}",
      start_index: 1,
      padding: 6,
    },
  },
  execution: {
    mode: "prefer_accelerator",
    accelerator_id: "cuda:0",
    max_workers: 6,
    batch_size: 24,
  },
  created_at: new Date(Date.now() - 20_000).toISOString(),
  completed_at: null,
  undone_at: null,
  error_message: null,
  runtime: null,
};

function legacyOperation(status: string, itemCount: number): PreprocessOperation {
  return {
    id: `legacy-${status}`,
    status,
    item_count: itemCount,
    options: runningOperation.options,
    execution: runningOperation.execution,
    created_at: "2026-07-25T08:00:00Z",
    completed_at: status === "completed" ? "2026-07-25T08:01:00Z" : null,
    undone_at: null,
    error_message: null,
    runtime: null,
  };
}

describe("preprocess operation task details", () => {
  test("shows durable progress, ETA, current file, and execution settings", async () => {
    const user = userEvent.setup();
    const onBack = vi.fn();

    render(<PreprocessOperationDetailPanel operation={runningOperation} onBack={onBack} />);

    const progress = screen.getByRole("progressbar", { name: "预处理进度" });
    expect(progress.getAttribute("aria-valuenow")).toBe("40");
    expect(screen.getByText("4 / 10 张图片")).toBeTruthy();
    expect(screen.getByText("预计剩余 30 秒")).toBeTruthy();
    expect(screen.getByText(/当前已写入：processed\/image_000004\.webp/)).toBeTruthy();
    expect(screen.getByText("二次元低光晕", { exact: false })).toBeTruthy();
    expect(screen.getByText("CPU 6 线程 · 批大小 24")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "返回改动预览" }));
    expect(onBack).toHaveBeenCalledOnce();
  });

  test("turns the recovery record into a selectable task card", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();

    render(
      <PreprocessHistoryPanel
        operations={[runningOperation]}
        selectedOperationId={null}
        undoPending={false}
        onSelect={onSelect}
        onUndo={() => undefined}
      />,
    );

    await user.click(screen.getByRole("button", { name: "查看 10 张图片的预处理任务详情" }));
    expect(onSelect).toHaveBeenCalledWith("operation-running");
    expect(
      screen.getByRole("progressbar", { name: "预处理任务进度" }).getAttribute("aria-valuenow"),
    ).toBe("40");
    expect(screen.getByText("预计剩余 30 秒")).toBeTruthy();
  });

  test("never renders NaN when cached or old-backend tasks lack progress fields", () => {
    const completed = legacyOperation("completed", 159);
    const completedView = render(
      <PreprocessHistoryPanel
        operations={[completed]}
        selectedOperationId={completed.id}
        undoPending={false}
        onSelect={() => undefined}
        onUndo={() => undefined}
      />,
    );

    expect(completedView.container.textContent).not.toContain("NaN");
    expect(screen.getByText("159 / 159 · 已完成")).toBeTruthy();
    expect(
      screen.getByRole("progressbar", { name: "预处理任务进度" }).getAttribute("aria-valuenow"),
    ).toBe("100");
    completedView.unmount();

    const running = legacyOperation("running", 12);
    const runningView = render(
      <PreprocessOperationDetailPanel operation={running} onBack={() => undefined} />,
    );
    expect(runningView.container.textContent).not.toContain("NaN");
    expect(screen.getByText("已处理 12 张 · 总数暂不可用")).toBeTruthy();
    expect(screen.getByText("重启后端后可显示实时 ETA")).toBeTruthy();
    expect(
      screen.getByRole("progressbar", { name: "预处理进度" }).getAttribute("aria-valuenow"),
    ).toBeNull();
  });

  test("restores an active task into the center when the preprocess page mounts again", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        if (url.endsWith("/api/v1/workspaces/project-1")) {
          return jsonResponse({
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
            asset_count: 10,
            annotated_count: 0,
            invalid_count: 0,
          });
        }
        if (url.includes("/api/v1/workspaces/project-1/assets?")) {
          return jsonResponse({
            items: [],
            total: 10,
            offset: 0,
            limit: 1,
            status_counts: {},
          });
        }
        if (url.endsWith("/api/v1/system/image-processing/backends")) {
          return jsonResponse({
            revision: "test",
            backends: [
              {
                id: "cpu",
                kind: "cpu",
                label: "CPU",
                status: "ready",
                device_name: null,
                total_memory_bytes: null,
                supports_batch: false,
                decode_formats: ["png", "jpeg", "webp"],
                encode_formats: ["png", "jpeg", "webp"],
                resize_algorithms: ["lanczos3", "lanczos4", "anime_low_halo"],
                issue: null,
              },
            ],
          });
        }
        if (url.endsWith("/api/v1/workspaces/project-1/preprocessing/operations")) {
          return jsonResponse([runningOperation]);
        }
        if (url.includes("/api/v1/workspaces/project-1/jobs?")) {
          return jsonResponse([]);
        }
        if (url.endsWith("/api/v1/workspaces/project-1/exports")) {
          return jsonResponse([]);
        }
        throw new Error(`Unexpected request: ${url}`);
      }),
    );
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const user = userEvent.setup();

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/workspace/project-1/preprocess"]}>
          <Routes>
            <Route path="/workspace/:projectId/preprocess" element={<PreprocessPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(await screen.findByRole("heading", { name: "预处理任务详情" })).toBeTruthy();
    expect(screen.getByText("4 / 10 张图片")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "返回改动预览" }));
    expect(screen.getByRole("heading", { name: "改动预览" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "查看 10 张图片的预处理任务详情" }));
    expect(screen.getByRole("heading", { name: "预处理任务详情" })).toBeTruthy();
  });
});
