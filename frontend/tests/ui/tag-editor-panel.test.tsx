import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, test, vi } from "vitest";

import { TagEditorPanel } from "../../src/pages/workspace/components/TagEditorPanel";
import type { AnnotationTag } from "../../src/shared/api/types";

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

function Harness() {
  const [tags, setTags] = useState<AnnotationTag[]>([
    {
      name: "alice",
      category: "character",
      confidence: 0.96,
      origin: "tagger",
    },
  ]);
  return (
    <>
      <TagEditorPanel
        projectId="project-1"
        assetId="asset-1"
        tags={tags}
        taggerSource={{
          installation_id: "installation-1",
          installation_name: "CL Tagger V2",
          adapter_id: "cl_tagger_v2",
          model_version: "v2.01a",
          fingerprint: "a".repeat(64),
        }}
        fontSize={12}
        onChange={setTags}
        onFontSizeChange={() => undefined}
      />
      <output aria-label="Tag 状态">{JSON.stringify(tags)}</output>
    </>
  );
}

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("structured tag editor", () => {
  test("groups model tags and adds categorized vocabulary suggestions", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("/api/v1/taggers")) {
        return jsonResponse({
          model_root: "D:\\models\\taggers",
          disk_size: 1,
          installations: [
            {
              id: "installation-1",
              name: "CL Tagger V2",
              adapter_id: "cl_tagger_v2",
              adapter_name: "CL Tagger V2",
              adapter_contract_version: 1,
              model_version: "v2.01a",
              relative_path: "cl",
              path: "D:\\models\\taggers\\cl",
              fingerprint: "a".repeat(64),
              status: "ready",
              issues: [],
              warnings: [],
              tag_count: 2,
              categories: { character: 1, general: 1 },
              profile_capabilities: {
                supported_selection_modes: ["global"],
                default_selection: {
                  mode: "global",
                  global_threshold: 0.5,
                  category_thresholds: {},
                  max_tags: null,
                },
                default_categories: ["character", "general"],
              },
              files: [],
              source: null,
              disk_size: 1,
              created_at: "2026-07-25T08:00:00Z",
              updated_at: "2026-07-25T08:00:00Z",
            },
          ],
          profiles: [],
          runtime: {
            available: true,
            providers: ["CPUExecutionProvider"],
            devices: ["auto", "cpu"],
            error: null,
          },
          supported_adapters: [],
          scan_issues: [],
        });
      }
      if (url.includes("/installations/installation-1/vocabulary/search")) {
        return jsonResponse({
          installation_id: "installation-1",
          installation_name: "CL Tagger V2",
          fingerprint: "a".repeat(64),
          query: "blue",
          category: null,
          items: [{ name: "blue_hair", category: "general" }],
        });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(
      <QueryClientProvider client={createQueryClient()}>
        <Harness />
      </QueryClientProvider>,
    );

    expect(await screen.findByText("角色")).toBeTruthy();
    expect(screen.getByText("alice")).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "自动补全词库" }).textContent).toContain(
      "跟随来源 · CL Tagger V2",
    );

    const input = screen.getByRole("combobox", { name: "搜索或添加 Tag" });
    await user.type(input, "blue");
    await user.click(await screen.findByRole("option", { name: /blue_hair/ }));

    const stateAfterAdd = JSON.parse(
      screen.getByRole("status", { name: "Tag 状态" }).textContent ?? "[]",
    ) as AnnotationTag[];
    expect(stateAfterAdd.at(-1)).toEqual({
      name: "blue_hair",
      category: "general",
      confidence: null,
      origin: "manual",
    });
    expect(screen.getByText("通用")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "删除 Tag：alice" }));
    await waitFor(() => {
      expect(screen.queryByText("alice")).toBeNull();
    });
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/installations/installation-1/vocabulary/search?q=blue&limit=24"),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });
});
