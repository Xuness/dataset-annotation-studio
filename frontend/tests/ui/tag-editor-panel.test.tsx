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
  test("shows translations, supports Chinese lookup, and preserves categories", async () => {
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
          items: [
            { name: "blue_hair", category: "general" },
            { name: "blue_eyes", category: "general" },
          ],
        });
      }
      if (url.includes("/api/v1/tag-dictionaries/entries/search")) {
        return jsonResponse({
          query: "蓝眼睛",
          language: "zh-CN",
          items: [
            {
              tag: "blue_eyes",
              normalized_tag: "blue_eyes",
              effective_translation: "蓝眼睛",
              source_kind: "dictionary",
              source_name: "中文 Tag 词典",
              installation_id: "dictionary-1",
              adapter_id: "tagcomplete_cn",
              category: "general",
              post_count: 200,
              override: null,
            },
          ],
          total: 1,
          offset: 0,
          limit: 80,
        });
      }
      if (url.endsWith("/api/v1/tag-dictionaries/resolve")) {
        return jsonResponse({
          language: "zh-CN",
          entries: [
            {
              requested_tag: "blue_hair",
              normalized_tag: "blue_hair",
              translation: "蓝发",
              matched: true,
              source_kind: "dictionary",
              installation_id: "dictionary-1",
              installation_name: "中文 Tag 词典",
              adapter_id: "tagcomplete_cn",
              source_version: "test",
              category: "general",
              post_count: 100,
              override_revision: null,
            },
            {
              requested_tag: "blue_eyes",
              normalized_tag: "blue_eyes",
              translation: "蓝眼睛",
              matched: true,
              source_kind: "dictionary",
              installation_id: "dictionary-1",
              installation_name: "中文 Tag 词典",
              adapter_id: "tagcomplete_cn",
              source_version: "test",
              category: "general",
              post_count: 200,
              override_revision: null,
            },
          ],
          resolution_hash: "b".repeat(64),
          unmatched_count: 0,
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
    const translatedSuggestion = await screen.findByRole("option", {
      name: /blue_hair.*蓝发/u,
    });
    expect(translatedSuggestion.textContent).toContain("blue_hair");
    expect(translatedSuggestion.textContent).toContain("蓝发");
    expect(
      translatedSuggestion.querySelector(".tag-editor__suggestion-name")?.getAttribute("title"),
    ).toBe("blue_hair");
    expect(
      translatedSuggestion
        .querySelector(".tag-editor__suggestion-translation")
        ?.getAttribute("title"),
    ).toBe("蓝发");
    expect(screen.getByRole("option", { name: /blue_eyes.*蓝眼睛/u })).toBeTruthy();
    await user.click(translatedSuggestion);

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

    await user.type(input, "蓝眼睛");
    const chineseSuggestion = await screen.findByRole("option", {
      name: /blue_eyes.*蓝眼睛/u,
    });
    await user.click(chineseSuggestion);

    const stateAfterChineseSearch = JSON.parse(
      screen.getByRole("status", { name: "Tag 状态" }).textContent ?? "[]",
    ) as AnnotationTag[];
    expect(stateAfterChineseSearch.at(-1)).toEqual({
      name: "blue_eyes",
      category: "general",
      confidence: null,
      origin: "manual",
    });

    await user.click(screen.getByRole("button", { name: "删除 Tag：alice" }));
    await waitFor(() => {
      expect(screen.queryByText("alice")).toBeNull();
    });
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/installations/installation-1/vocabulary/search?q=blue&limit=24"),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/v1/tag-dictionaries/resolve"),
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          tags: ["blue_hair", "blue_eyes"],
          categories: ["general", "general"],
          language: "zh-CN",
        }),
      }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining(
        "/api/v1/tag-dictionaries/entries/search?q=%E8%93%9D%E7%9C%BC%E7%9D%9B&language=zh-CN&limit=80",
      ),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(
      fetchMock.mock.calls.filter(([request]) => String(request).includes("/vocabulary/search")),
    ).toHaveLength(1);
  });
});
