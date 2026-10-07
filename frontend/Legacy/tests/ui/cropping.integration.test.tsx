import type { ComponentType } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterAll, beforeAll, expect, test, vi } from "vitest";

import { startCroppingServer, type CroppingTestServer } from "../../../tests/croppingServer";
import type { AssetSummary, CropOperation } from "../../../src/shared/api/types";

let server: CroppingTestServer;
let App: ComponentType;
let selection: (typeof import("../../../src/shared/store/workspaceSelectionStore"))["useWorkspaceSelectionStore"];
let client: QueryClient;
let listAssets: (typeof import("../../../src/features/assets/api"))["listAssets"];
let useController: (typeof import("../../../src/application/workspace/useWorkspaceAssetsController"))["useWorkspaceAssetsController"];
let legacyInteractions: typeof import("../../legacy/legacyInteractions");
let cropApi: typeof import("../../../src/features/cropping/api");
let browserState: typeof import("../../../src/application/workspace/assetBrowserState");
let listOperations: (typeof import("../../../src/features/cropping/api"))["listCropOperations"];
beforeAll(async () => {
  server = await startCroppingServer();
  vi.stubEnv("VITE_API_BASE_URL", server.info.base_url);
  App = (await import("../../legacy/LegacyApp")).LegacyApp;
  selection = (await import("../../../src/shared/store/workspaceSelectionStore"))
    .useWorkspaceSelectionStore;
  listAssets = (await import("../../../src/features/assets/api")).listAssets;
  useController = (await import("../../../src/application/workspace/useWorkspaceAssetsController"))
    .useWorkspaceAssetsController;
  legacyInteractions = await import("../../legacy/legacyInteractions");
  cropApi = await import("../../../src/features/cropping/api");
  browserState = await import("../../../src/application/workspace/assetBrowserState");
  listOperations = (await import("../../../src/features/cropping/api")).listCropOperations;
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
}, 30000);
afterAll(async () => {
  cleanup();
  client?.clear();
  vi.unstubAllEnvs();
  if (server) await server.stop();
});
function renderApp(path: string): void {
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
async function click(id: string): Promise<void> {
  await waitFor(
    () => expect(screen.getByTestId<HTMLButtonElement>(id).matches(":disabled"), id).toBe(false),
    {
      timeout: 5000,
    },
  );
  await act(async () => {
    fireEvent.click(screen.getByTestId(id));
  });
}
async function allAssets(): Promise<AssetSummary[]> {
  return (await listAssets(server.info.project_id, { candidateScope: "all" })).items;
}
async function latest(): Promise<CropOperation> {
  const rows = await listOperations(server.info.project_id);
  if (!rows.length) throw new Error("Missing crop operation");
  return rows[0];
}

test("inline crop workspaces preserve multi-source drafts, generate pending items atomically, and never return to assets", async () => {
  const project = server.info.project_id;
  const originals = await allAssets();
  const first = originals.find((asset) => asset.filename === "original.png")!;
  const second = originals.find((asset) => asset.filename === "second.png")!;
  selection.getState().setActiveProject(project);
  selection.getState().setAssetsChecked([first.id, second.id], true);
  renderApp(`/workspace/${project}/preprocess?tool=crop-single`);
  await screen.findByTestId("crop-canvas", {}, { timeout: 10000 });
  expect(screen.queryByTestId("crop-close")).toBeNull();
  await click("crop-add-frame");
  await click("crop-lock-ratio");
  await click("crop-add-frame");
  fireEvent.change(screen.getByTestId("crop-coordinate-width"), { target: { value: "40" } });
  expect(screen.getByTestId<HTMLInputElement>("crop-coordinate-height").value).toBe("40");
  await waitFor(() =>
    expect(
      screen.getByTestId("asset-browser-list").querySelector(".asset-list__virtual"),
    ).not.toBeNull(),
  );
  fireEvent.keyDown(screen.getByTestId("asset-browser-list"), { key: "Home" });
  await waitFor(() =>
    expect(screen.getByTestId("crop-canvas-viewport").querySelector("img")?.alt).toBe("second.png"),
  );
  await click("crop-add-frame");
  await click("crop-view-overview");
  expect(screen.getByTestId("crop-workbench-counts").textContent).toContain("3 个待生成区域");
  await click(`crop-overview-${first.id}`);
  expect(screen.getByTestId<HTMLInputElement>("crop-coordinate-width").value).toBe("40");
  fireEvent.change(screen.getByTestId("crop-coordinate-x"), { target: { value: "-1" } });
  expect(screen.getByTestId<HTMLButtonElement>("crop-generate-all").disabled).toBe(true);
  fireEvent.change(screen.getByTestId("crop-coordinate-x"), { target: { value: "0" } });
  await click("preprocess-tab-crop");
  await screen.findByTestId("crop-batch-workbench");
  await click(`crop-overview-${first.id}`);
  expect(screen.queryByTestId("crop-draw-mode")).toBeNull();
  expect(screen.queryByTestId("crop-handle-0")).toBeNull();
  fireEvent.change(screen.getByTestId("crop-position-x"), { target: { value: "0" } });
  await click("crop-ratio-quick-builtin-16-9");
  await click("dialog-cancel");
  expect(screen.getByTestId<HTMLInputElement>("crop-ratio-width").value).toBe("1");
  expect(screen.getByTestId<HTMLInputElement>("crop-position-x").value).toBe("0");
  await click("preprocess-tab-single");
  await screen.findByTestId("crop-select-1");
  await click("crop-generate-current");
  await click("dialog-confirm");
  await waitFor(async () => expect((await allAssets()).length).toBe(4));
  await waitFor(() =>
    expect(screen.getByTestId<HTMLButtonElement>("crop-generate-current").disabled).toBe(true),
  );
  expect(screen.getByTestId("crop-select-1")).toBeTruthy();
  expect(screen.getByTestId("crop-workbench-counts").textContent).toContain("1 个待生成区域");
  await click("crop-generate-all");
  await click("dialog-confirm");
  await waitFor(async () => expect((await allAssets()).length).toBe(5));
  await waitFor(() =>
    expect(screen.getByTestId<HTMLButtonElement>("crop-generate-all").disabled).toBe(true),
  );
  await waitFor(() =>
    expect(screen.getByTestId("crop-coordinate-width").matches(":disabled")).toBe(false),
  );
  fireEvent.change(screen.getByTestId("crop-coordinate-width"), { target: { value: "30" } });
  expect(screen.getByTestId("crop-workbench-counts").textContent).toContain("1 个待生成区域");
  await click("crop-generate-all");
  await click("dialog-confirm");
  await waitFor(async () => expect((await allAssets()).length).toBe(6));
  await click("crop-regenerate-current");
  await click("dialog-confirm");
  await waitFor(async () => expect((await allAssets()).length).toBe(8));
  await waitFor(() =>
    expect(screen.getByTestId<HTMLButtonElement>("crop-regenerate-current").disabled).toBe(false),
  );
  const operation = await latest();
  await click(`crop-undo-${operation.id}`);
  await click("dialog-confirm");
  await waitFor(async () => expect((await allAssets()).length).toBe(6));
  expect(screen.getByTestId("crop-single-workbench")).toBeTruthy();
  expect(selection.getState().checkedAssetIds).toEqual([first.id, second.id]);
}, 30000);

test("batch keeps empty selection empty and saves common custom ratio presets", async () => {
  cleanup();
  client.clear();
  const project = server.info.project_id;
  selection.getState().clearCheckedAssets();
  renderApp(`/workspace/${project}/preprocess?tool=crop`);
  await screen.findByTestId("crop-batch-workbench", {}, { timeout: 10000 });
  await waitFor(() =>
    expect(screen.getByTestId("crop-workbench-counts").textContent).toContain("0 张源图"),
  );
  expect(screen.getByTestId<HTMLButtonElement>("crop-generate-all").disabled).toBe(true);
  fireEvent.change(screen.getByTestId("crop-source-scope"), { target: { value: "all" } });
  await waitFor(() =>
    expect(screen.getByTestId("crop-workbench-counts").textContent).toContain("2 张源图"),
  );
  await waitFor(() =>
    expect(screen.getByTestId<HTMLSelectElement>("crop-ratio-preset").options.length).toBe(8),
  );
  fireEvent.click(screen.getByTestId("crop-preset-manager"));
  fireEvent.change(screen.getByTestId("crop-preset-name"), {
    target: { value: "Cinema UI preset" },
  });
  fireEvent.change(screen.getByTestId("crop-ratio-width"), { target: { value: "" } });
  fireEvent.change(screen.getByTestId("crop-ratio-height"), { target: { value: "1e300" } });
  fireEvent.change(screen.getByTestId("crop-ratio-width"), { target: { value: "1e-300" } });
  expect(screen.getByTestId("crop-ratio-error").textContent).toContain("比例因子");
  expect(screen.getByTestId<HTMLButtonElement>("crop-generate-all").disabled).toBe(true);
  expect(screen.getByTestId<HTMLButtonElement>("crop-preset-create").disabled).toBe(true);
  await click("crop-ratio-quick-builtin-16-9");
  await click("dialog-confirm");
  fireEvent.click(screen.getByTestId("crop-preset-manager"));
  fireEvent.change(screen.getByTestId("crop-preset-name"), {
    target: { value: "Cinema UI preset" },
  });
  await click("crop-preset-create");
  await waitFor(() =>
    expect(screen.getByTestId<HTMLSelectElement>("crop-ratio-preset").options.length).toBe(9),
  );
  const beforeId = (await latest()).id;
  await click("crop-generate-all");
  await click("dialog-confirm");
  await waitFor(async () => {
    const result = await latest();
    expect(result.id).not.toBe(beforeId);
    expect(result.status).toBe("succeeded");
    expect(result.total).toBe(2);
  });
  const operation = await latest();
  await click(`crop-undo-${operation.id}`);
  await click("dialog-confirm");
  await waitFor(async () => expect((await latest()).status).toBe("undone"));
}, 30000);

test("delete removes regions from the top without selection and removed canvas controls stay absent", async () => {
  cleanup();
  client.clear();
  const project = server.info.project_id;
  const source = (await allAssets()).find((asset) => asset.filename === "original.png")!;
  const { cropWorkbenchState, cropScopeKey } =
    await import("../../../src/application/cropping/workbenchState");
  cropWorkbenchState.reset(cropScopeKey(project, "single"));
  selection.getState().clearCheckedAssets();
  selection.getState().setAssetsChecked([source.id], true);
  renderApp(`/workspace/${project}/preprocess?tool=crop-single`);
  await screen.findByTestId("crop-canvas", {}, { timeout: 10000 });
  for (const width of [30, 40, 50]) {
    await click("crop-add-frame");
    fireEvent.change(screen.getByTestId("crop-coordinate-width"), {
      target: { value: String(width) },
    });
  }
  const key = cropScopeKey(project, "single");
  const originalIds = cropWorkbenchState
    .get(key)
    .drafts[source.id].regions.map((region) => region.id);
  act(() =>
    cropWorkbenchState.patch(key, (state) => ({
      drafts: { ...state.drafts, [source.id]: { ...state.drafts[source.id], selected: -1 } },
    })),
  );
  expect(screen.queryByTestId("crop-coordinate-width")).toBeNull();
  await click("crop-delete-frame");
  expect(cropWorkbenchState.get(key).drafts[source.id].regions.map((region) => region.id)).toEqual(
    originalIds.slice(1),
  );
  expect(screen.getByTestId<HTMLInputElement>("crop-coordinate-width").value).toBe("40");
  await click("crop-select-1");
  await click("crop-delete-frame");
  expect(cropWorkbenchState.get(key).drafts[source.id].regions[0].id).toBe(originalIds[2]);
  expect(screen.getByTestId<HTMLInputElement>("crop-coordinate-width").value).toBe("50");
  await click("crop-delete-frame");
  expect(screen.getByTestId<HTMLButtonElement>("crop-delete-frame").disabled).toBe(true);
  expect(screen.queryByTestId("crop-draw-mode")).toBeNull();
  expect(screen.queryByTestId("crop-zoom")).toBeNull();
  expect(screen.queryByTestId("crop-actual")).toBeNull();
  expect(screen.getByTestId("crop-zoom-level").textContent).toBe("100%");
  expect(screen.getByTestId("crop-center-scroll")).toBeTruthy();
  expect(screen.getByTestId("crop-inspector-scroll")).toBeTruthy();
}, 15000);

test("material-style crop browser shares checks without silently changing the processing scope", async () => {
  cleanup();
  client.clear();
  const project = server.info.project_id;
  const assets = await allAssets();
  const original = assets.find((asset) => asset.filename === "original.png")!;
  const second = assets.find((asset) => asset.filename === "second.png")!;
  const { cropWorkbenchState, cropScopeKey } =
    await import("../../../src/application/cropping/workbenchState");
  const { cropBrowserState, cropBrowserKey } =
    await import("../../../src/application/cropping/cropBrowserState");
  const key = cropScopeKey(project, "single");
  cropWorkbenchState.reset(key);
  cropBrowserState.reset(cropBrowserKey(project, "single", "assets"));
  selection.getState().clearCheckedAssets();
  selection.getState().setAssetsChecked([original.id], true);
  renderApp(`/workspace/${project}/preprocess?tool=crop-single`);
  await screen.findByTestId("crop-canvas", {}, { timeout: 10000 });
  fireEvent.change(screen.getByTestId("asset-browser-search"), { target: { value: "second.png" } });
  await waitFor(() =>
    expect(screen.getByTestId("asset-browser-panel").textContent).toContain("1 张图片"),
  );
  fireEvent.keyDown(screen.getByTestId("asset-browser-list"), { key: "Home" });
  await screen.findByTestId("crop-outside-scope");
  expect(screen.getByTestId<HTMLButtonElement>("crop-add-frame").disabled).toBe(true);
  expect(screen.getByTestId<HTMLButtonElement>("crop-generate-current").disabled).toBe(true);
  expect(selection.getState().checkedAssetIds).toEqual([original.id]);
  await click("asset-browser-toggle-all");
  await waitFor(() =>
    expect(screen.getByTestId("crop-sidebar-counts").textContent).toContain("2 张源图"),
  );
  await click("crop-add-frame");
  await click("asset-browser-toggle-all");
  await waitFor(() =>
    expect(screen.getByTestId("crop-sidebar-counts").textContent).toContain("1 张源图"),
  );
  expect(cropWorkbenchState.get(key).drafts[second.id].regions).toHaveLength(1);
  expect(selection.getState().checkedAssetIds).toEqual([original.id]);
}, 15000);

function SelectionProbe({ projectId }: { projectId: string }) {
  const controller = useController({
    projectId,
    mode: "assets",
    confirm: legacyInteractions.legacyConfirm,
    alert: legacyInteractions.legacyAlert,
  });
  return (
    <div>
      <output data-testid="cropping-selected-source">{controller.selectedAsset?.id}</output>
      <output data-testid="cropping-loaded-assets">{controller.assetItems.length}</output>
      <output data-testid="cropping-selection-error">{controller.selectionError}</output>
    </div>
  );
}

test("current original remains selected when 501 new images push it beyond the loaded page", async () => {
  cleanup();
  client.clear();
  const project = server.info.project_id;
  const source = (await allAssets()).find((asset) => asset.filename === "original.png");
  if (!source) throw new Error("Original source image missing from the real dataset");
  const rectangles = Array.from({ length: 501 }, () => ({
    x: 0,
    y: 0,
    width: 10,
    height: 10,
    ratio: null,
  }));
  const preview = await cropApi.previewSingle(project, { asset_id: source.id, rectangles });
  await cropApi.executeCrop(project, preview);
  browserState.assetBrowserViewState.patch(browserState.browserScopeKey(project, "assets"), {
    selectedAssetId: source.id,
    search: "",
    statusFilter: null,
    folderPath: "",
    candidateScope: "auto",
  });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <SelectionProbe projectId={project} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  await waitFor(
    () => expect(screen.getByTestId("cropping-selected-source").textContent).toBe(source.id),
    { timeout: 10000 },
  );
  expect(screen.getByTestId("cropping-loaded-assets").textContent).toBe("500");
  expect(screen.getByTestId("cropping-selection-error").textContent).toBe("");
}, 30000);
