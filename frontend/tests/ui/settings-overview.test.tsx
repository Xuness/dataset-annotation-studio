import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, describe, expect, test, vi } from "vitest";

const writeClipboardText = vi.hoisted(() => vi.fn(async () => undefined));
const openLocalFolder = vi.hoisted(() => vi.fn(async () => undefined));
const resolveDesktopLogDirectory = vi.hoisted(() =>
  vi.fn(async () => "C:\\AppData\\Dataset Studio\\logs"),
);

vi.mock("../../src/shared/desktop/writeClipboardText", () => ({ writeClipboardText }));
vi.mock("../../src/shared/desktop/openLocalFolder", () => ({ openLocalFolder }));
vi.mock("../../src/shared/desktop/logDirectories", () => ({ resolveDesktopLogDirectory }));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true }));
vi.mock("../../src/pages/presets/components/SystemPresetsPanel", () => ({
  SystemPresetsPanel: ({ createSignal }: { createSignal: number }) => (
    <output aria-label="System Prompt 创建信号">{createSignal}</output>
  ),
}));
vi.mock("../../src/pages/presets/components/TranslationPromptsPanel", () => ({
  TranslationPromptsPanel: ({ createSignal }: { createSignal: number }) => (
    <output aria-label="翻译 Prompt 创建信号">{createSignal}</output>
  ),
}));
vi.mock("../../src/pages/presets/components/ProviderProfilesPanel", () => ({
  ProviderProfilesPanel: ({ createSignal }: { createSignal: number }) => (
    <output aria-label="模型连接创建信号">{createSignal}</output>
  ),
}));

import { PresetsPage } from "../../src/pages/presets/PresetsPage";
import { AboutSettings } from "../../src/app/settings/sections/AboutSettings";
import { PresetSettings } from "../../src/app/settings/sections/PresetSettings";
import { TaggerSettings } from "../../src/app/settings/sections/TaggerSettings";
import { SETTINGS_SECTION_IDS } from "../../src/shared/settings/settingsSectionIds";

function createQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
}

function LocationProbe() {
  const location = useLocation();
  return <output aria-label="当前位置">{`${location.pathname}${location.search}`}</output>;
}

function jsonResponse(data: unknown) {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("settings overview sections", () => {
  test("registers appearance, presets, local taggers and diagnostics in stable order", () => {
    expect(SETTINGS_SECTION_IDS).toEqual(["appearance", "presets", "taggers", "about"]);
  });

  test("summarizes preset resources and deep-links into creation", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("/api/v1/presets/system")) {
        return jsonResponse([
          { id: "system-1", name: "结构化标注", system_prompt: "one" },
          { id: "system-2", name: "自然语言描述", system_prompt: "two" },
        ]);
      }
      if (url.endsWith("/api/v1/presets/translation-prompts")) {
        return jsonResponse([{ id: "translation-1", name: "中文翻译", system_prompt: "three" }]);
      }
      if (url.endsWith("/api/v1/presets/providers")) {
        return jsonResponse([
          {
            id: "provider-1",
            name: "我的 OpenRouter",
            provider_type: "openrouter",
            base_url: "https://openrouter.ai/api/v1",
            default_model_id: "model-1",
            models: [{ model_id: "model-1" }],
            concurrency: 2,
            has_api_key: true,
          },
        ]);
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const onClose = vi.fn();
    const user = userEvent.setup();

    render(
      <QueryClientProvider client={createQueryClient()}>
        <MemoryRouter initialEntries={["/"]}>
          <PresetSettings onClose={onClose} />
          <LocationProbe />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(await screen.findByText("2 套预设")).toBeTruthy();
    expect(screen.getByText("1 套预设")).toBeTruthy();
    expect(screen.getByText("1 个连接 · 1 个模型")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "新建System Prompt" }));

    expect(onClose).toHaveBeenCalledOnce();
    expect(screen.getByRole("status", { name: "当前位置" }).textContent).toBe(
      "/presets?tab=system&action=create",
    );
  });

  test("shows the local tagger library and audited Hugging Face catalog", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        if (url.endsWith("/api/v1/taggers/downloads")) {
          return jsonResponse({
            offers: [
              {
                plan_id: "cl_tagger_v2:v2_01a",
                adapter_id: "cl_tagger_v2",
                adapter_name: "CL Tagger v2",
                name: "CL Tagger v2 v2.01a",
                model_version: "v2.01a",
                description: "固定审核版本",
                repo_id: "cella110n/cl_tagger_v2",
                revision: "b57909b8e9c63f71e208a26473e7aabdf45ed6b6",
                source_url: "https://huggingface.co/cella110n/cl_tagger_v2",
                gated: true,
                provenance: "author",
                download_size: 2_200_000_000,
                file_count: 4,
                installed_installation_id: null,
                installed_installation_name: null,
                active_download_id: null,
              },
            ],
            tasks: [],
            huggingface: {
              token_source: "anonymous",
              has_saved_token: false,
              proxy_mode: "environment",
              has_custom_proxy: false,
              proxy_display: null,
            },
          });
        }
        return jsonResponse({
          model_root: "C:\\AppData\\DatasetAnnotationStudio\\models\\taggers",
          disk_size: 0,
          installations: [],
          profiles: [],
          runtime: {
            available: true,
            providers: ["CPUExecutionProvider"],
            devices: ["auto", "cpu"],
            error: null,
          },
          supported_adapters: [{ id: "cl_tagger_v2", name: "CL Tagger v2", description: "test" }],
          scan_issues: [],
        });
      }),
    );

    render(
      <QueryClientProvider client={createQueryClient()}>
        <TaggerSettings onClose={() => undefined} />
      </QueryClientProvider>,
    );

    expect(await screen.findByText("ONNX Runtime 已就绪")).toBeTruthy();
    expect(screen.getByText("CPUExecutionProvider")).toBeTruthy();
    expect(screen.getByRole("button", { name: "导入本地模型" })).toBeTruthy();
    await user.click(screen.getByRole("tab", { name: "Hugging Face 下载" }));
    expect(await screen.findByText("可下载模型")).toBeTruthy();
    expect(screen.getByText("CL Tagger v2 v2.01a")).toBeTruthy();
    expect(screen.getByRole("button", { name: "下载并安装" })).toBeTruthy();
  });

  test("shows live service diagnostics and copies a privacy-safe summary", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        status: "ok",
        version: "0.1.0",
        app_data_dir: "C:\\AppData\\DatasetAnnotationStudio",
        log_dir: "C:\\AppData\\DatasetAnnotationStudio\\logs",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(
      <QueryClientProvider client={createQueryClient()}>
        <AboutSettings onClose={() => undefined} />
      </QueryClientProvider>,
    );

    expect(await screen.findByText("本地服务连接正常")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "复制诊断摘要" }));

    await waitFor(() => expect(writeClipboardText).toHaveBeenCalledOnce());
    const summary = String(writeClipboardText.mock.calls[0][0]);
    expect(summary).toContain("Service: connected");
    expect(summary).toContain("Backend version: 0.1.0");
    expect(summary).toContain("Logs: C:\\AppData\\Dataset Studio\\logs");
    expect(summary).not.toContain("API Key");
    expect(await screen.findByText("诊断摘要已复制")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "打开日志目录" }));
    await waitFor(() =>
      expect(openLocalFolder).toHaveBeenCalledWith("C:\\AppData\\Dataset Studio\\logs"),
    );
    expect(await screen.findByText("已打开当前日志目录")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "重新检测" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(await screen.findByText(/检测完成 ·/)).toBeTruthy();
  });

  test("keeps developer logs available when the local service is offline", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Promise.reject(new Error("service offline"))),
    );
    const user = userEvent.setup();

    render(
      <QueryClientProvider client={createQueryClient()}>
        <AboutSettings onClose={() => undefined} />
      </QueryClientProvider>,
    );

    expect(await screen.findByText("服务未连接")).toBeTruthy();
    const openLogsButton = screen.getByRole("button", { name: "打开日志目录" });
    await waitFor(() => expect((openLogsButton as HTMLButtonElement).disabled).toBe(false));
    await user.click(openLogsButton);

    await waitFor(() =>
      expect(openLocalFolder).toHaveBeenCalledWith("C:\\AppData\\Dataset Studio\\logs"),
    );
  });
});

describe("preset library deep links", () => {
  test("opens the requested editor in creation mode", async () => {
    render(
      <MemoryRouter initialEntries={["/presets?tab=translation&action=create"]}>
        <PresetsPage />
        <LocationProbe />
      </MemoryRouter>,
    );

    await waitFor(() =>
      expect(screen.getByRole("status", { name: "翻译 Prompt 创建信号" }).textContent).toBe("1"),
    );
    expect(screen.getByRole("status", { name: "当前位置" }).textContent).toBe(
      "/presets?tab=translation",
    );
  });
});
