import type { ComponentType } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterAll, afterEach, beforeAll, expect, test, vi } from "vitest";

import {
  startCharacterAuditServer,
  type CharacterAuditTestServer,
} from "../../../tests/characterAuditServer";
import { clickControl, exerciseCharacterAuditSteps } from "../../../tests/characterAuditFlow";

import { useWorkspaceSelectionStore } from "../../../src/shared/store/workspaceSelectionStore";

let server: CharacterAuditTestServer;
let App: ComponentType;
let queryClient: QueryClient;
let readBundle: (typeof import("../../../src/features/annotations/api"))["getAnnotationBundle"];

beforeAll(async () => {
  server = await startCharacterAuditServer();
  vi.stubEnv("VITE_API_BASE_URL", server.info.base_url);
  App = (await import("../../legacy/LegacyApp")).LegacyApp;
  readBundle = (await import("../../../src/features/annotations/api")).getAnnotationBundle;
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
}, 30_000);

afterEach(() => {
  cleanup();
  queryClient.clear();
});

afterAll(async () => {
  cleanup();
  queryClient?.clear();
  vi.unstubAllEnvs();
  if (server) await server.stop();
});

function renderApp(path: string): void {
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

test("classic navigation, real API audit workflow, native confirmation, and persisted refresh", async () => {
  const info = server.info;
  renderApp(`/workspace/${info.project_id}/jobs`);
  await screen.findByTestId("workspace-nav-characters", {}, { timeout: 10_000 });
  await clickControl("job-kind-character");
  await clickControl(`character-open-${info.review_id}`);
  await clickControl("job-character-open-workbench");
  await screen.findByTestId("legacy-character-workbench");
  await screen.findByTestId("character-reason-0");
  fireEvent.change(screen.getByTestId("character-reason-0"), {
    target: { value: "Unsaved human decision" },
  });
  await screen.findByTestId("character-selected-image");
  await waitFor(() =>
    expect(screen.getByTestId("character-selected-image").getAttribute("alt")).toBe("0.png"),
  );
  fireEvent.keyDown(screen.getByTestId("asset-browser-list"), { key: "ArrowDown" });
  await waitFor(() =>
    expect(screen.getByTestId("character-selected-image").getAttribute("alt")).toBe("1.png"),
  );
  expect(screen.getByTestId<HTMLTextAreaElement>("character-reason-0").value).toBe(
    "Unsaved human decision",
  );
  expect(screen.getByTestId("character-review-tab-0").getAttribute("aria-pressed")).toBe("true");
  expect(screen.getByTestId<HTMLButtonElement>("character-set-reference").disabled).toBe(true);
  expect(screen.queryByTestId("dialog-confirm")).toBeNull();
  await clickControl("asset-browser-toggle-all");
  await waitFor(() =>
    expect(useWorkspaceSelectionStore.getState().checkedAssetIds).toHaveLength(3),
  );
  await clickControl("workspace-nav-jobs");
  await screen.findByTestId("dialog-cancel");
  await clickControl("dialog-cancel");
  expect(screen.getByTestId<HTMLTextAreaElement>("character-reason-0").value).toBe(
    "Unsaved human decision",
  );
  await clickControl("character-return");
  await screen.findByTestId("dialog-confirm");
  await clickControl("dialog-confirm");
  await clickControl(`character-open-${info.draft_id}`);
  await clickControl("job-character-open-workbench");
  await exerciseCharacterAuditSteps(info, {
    openTask: async (id) => {
      await clickControl("character-return");
      await clickControl(`character-open-${id}`);
      await clickControl("job-character-open-workbench");
    },
    showApply: () => clickControl("character-view-apply"),
  });
  await clickControl("character-apply");
  await screen.findByTestId("dialog-cancel");
  await clickControl("dialog-cancel");
  expect(screen.queryByTestId("character-applied")).toBeNull();
  await clickControl("character-apply");
  await screen.findByTestId("dialog-confirm");
  await clickControl("dialog-confirm");
  await screen.findByTestId("character-applied");
  const bundle = await readBundle(info.project_id, info.reference_id);
  const tags = bundle.documents.find((document) => document.channel === "tags");
  expect(tags?.review_status).toBe("unreviewed");
  expect(tags?.tags.some((tag) => tag.name === "red hair")).toBe(true);
  cleanup();
  queryClient.clear();
  renderApp(`/workspace/${info.project_id}/characters?operation=${info.review_id}`);
  await screen.findByTestId("character-applied");
  await waitFor(() =>
    expect(screen.getByTestId("workspace-nav-characters").getAttribute("aria-current")).toBe(
      "page",
    ),
  );
  expect(document.querySelector('[class*="dial-archive"]')).toBeNull();
}, 30_000);

test("new audit uses explicit references and rejects an empty selected scope", async () => {
  const info = server.info;
  useWorkspaceSelectionStore.getState().clearCheckedAssets();
  renderApp(`/workspace/${info.project_id}/characters`);
  await screen.findByTestId("character-selected-image", {}, { timeout: 10_000 });
  expect(screen.getByTestId<HTMLSelectElement>("character-scope").value).toBe("all");
  await clickControl("character-preview-membership");
  await waitFor(() =>
    expect(screen.getByTestId("character-message").textContent).toContain(
      "角色 1：请填写唯一触发词",
    ),
  );
  const message = screen.getByTestId("character-message").textContent;
  expect(message).toContain("请选择参考图");
  expect(message).toContain("请选择审查模型连接");
  expect(message).toContain("请选择视觉模型");
  expect(message).toContain("请选择已验证的语义词表");
  expect(message).not.toMatch(/profiles\.0|String should|provider_profile_id/);

  expect(screen.getByTestId<HTMLSelectElement>("character-reference-0").value).toBe("");
  await clickControl("character-set-reference");
  const reference = screen.getByTestId<HTMLSelectElement>("character-reference-0").value;
  expect(reference).not.toBe("");
  fireEvent.keyDown(screen.getByTestId("asset-browser-list"), { key: "ArrowDown" });
  await waitFor(() =>
    expect(screen.getByTestId("character-selected-image").getAttribute("alt")).toBe("1.png"),
  );
  expect(screen.getByTestId<HTMLSelectElement>("character-reference-0").value).toBe(reference);
  fireEvent.change(screen.getByTestId("character-vocabulary"), {
    target: { value: info.vocabulary_id },
  });
  fireEvent.change(screen.getByTestId("character-scope"), { target: { value: "selected" } });
  expect(screen.getByTestId<HTMLButtonElement>("character-create").disabled).toBe(true);
  expect(screen.getByTestId<HTMLButtonElement>("character-preview-membership").disabled).toBe(true);
  await clickControl("asset-browser-toggle-all");
  await waitFor(() =>
    expect(screen.getByTestId<HTMLButtonElement>("character-create").disabled).toBe(false),
  );
  expect(screen.getByTestId<HTMLSelectElement>("character-scope").value).toBe("selected");
  await clickControl("character-return");
  expect(await screen.findByTestId("character-job-list")).toBeTruthy();
  expect(screen.getByTestId("job-kind-character").getAttribute("aria-pressed")).toBe("true");
}, 15_000);
