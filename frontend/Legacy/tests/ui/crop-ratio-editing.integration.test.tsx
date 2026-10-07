import type { ComponentType } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterAll, afterEach, beforeAll, expect, test, vi } from "vitest";
import { startCroppingServer, type CroppingTestServer } from "../../../tests/croppingServer";

let server: CroppingTestServer;
let App: ComponentType;
let client: QueryClient;
let api: typeof import("../../../src/features/cropping/api");
let assetApi: typeof import("../../../src/features/assets/api");
let selection: (typeof import("../../../src/shared/store/workspaceSelectionStore"))["useWorkspaceSelectionStore"];

beforeAll(async () => {
  server = await startCroppingServer();
  vi.stubEnv("VITE_API_BASE_URL", server.info.base_url);
  App = (await import("../../legacy/LegacyApp")).LegacyApp;
  api = await import("../../../src/features/cropping/api");
  assetApi = await import("../../../src/features/assets/api");
  selection = (await import("../../../src/shared/store/workspaceSelectionStore"))
    .useWorkspaceSelectionStore;
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
}, 30000);
afterEach(() => {
  cleanup();
  client.clear();
});
afterAll(async () => {
  vi.unstubAllEnvs();
  if (server) await server.stop();
});

async function click(id: string) {
  await waitFor(() => expect(screen.getByTestId(id).matches(":disabled")).toBe(false));
  fireEvent.click(screen.getByTestId(id));
}

test.each(["single", "batch"] as const)(
  "%s ratio editing retains focus and custom preset state",
  async (mode) => {
    const user = userEvent.setup();
    const project = server.info.project_id;
    const source = (await assetApi.listAssets(project, { candidateScope: "all" })).items.find(
      (item) => item.filename === "original.png",
    )!;
    const preset = await api.createRatioPreset({
      name: `Review ${mode}`,
      ratio: { width: 2.35, height: 1 },
    });
    selection.getState().setActiveProject(project);
    selection.getState().clearCheckedAssets();
    selection.getState().setAssetsChecked([source.id], true);
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter
          initialEntries={[
            `/workspace/${project}/preprocess?tool=${mode === "single" ? "crop-single" : "crop"}`,
          ]}
        >
          <App />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    if (mode === "single") {
      await screen.findByTestId("crop-canvas", {}, { timeout: 10000 });
      await click("crop-add-frame");
      await click("crop-lock-ratio");
    } else {
      await screen.findByTestId(`crop-overview-${source.id}`, {}, { timeout: 10000 });
      await click(`crop-overview-${source.id}`);
      await click("crop-unified-ratio-toggle");
    }
    const width = await screen.findByTestId<HTMLInputElement>("crop-ratio-width");
    await user.clear(width);
    await user.type(width, "2.35");
    expect(screen.getByTestId("crop-ratio-width")).toBe(width);
    expect(document.activeElement).toBe(width);
    expect(width.value).toBe("2.35");
    const presetSelect = screen.getByTestId<HTMLSelectElement>("crop-ratio-preset");
    await waitFor(() =>
      expect([...presetSelect.options].some((option) => option.value === preset.id)).toBe(true),
    );
    await user.selectOptions(presetSelect, preset.id);
    await waitFor(() => expect(presetSelect.value).toBe(preset.id));
    await user.click(screen.getByTestId("crop-preset-manager"));
    const name = screen.getByTestId<HTMLInputElement>("crop-preset-name");
    await waitFor(() => expect(name.value).toBe(`Review ${mode}`));
    await user.clear(name);
    await user.type(name, `Renamed ${mode}`);
    await user.clear(width);
    await user.type(width, "3.25");
    expect(document.activeElement).toBe(width);
    expect(name.value).toBe(`Renamed ${mode}`);
    expect(presetSelect.value).toBe(preset.id);
    await click("crop-preset-update");
    await waitFor(async () => {
      const saved = (await api.listRatioPresets()).find((item) => item.id === preset.id);
      expect(saved?.name).toBe(`Renamed ${mode}`);
      expect(saved?.ratio.width).toBe(3.25);
    });
    if (mode === "batch") {
      fireEvent.change(screen.getByTestId("crop-position-y"), { target: { value: "0" } });
      await click("crop-ratio-quick-builtin-1-1");
      await screen.findByTestId("dialog-cancel");
      await click("dialog-cancel");
      await waitFor(() => expect(width.value).toBe("3.25"));
      expect(screen.getByTestId("crop-ratio-width")).toBe(width);
      expect(presetSelect.value).toBe(preset.id);
      expect(name.value).toBe(`Renamed ${mode}`);
      await click("crop-ratio-quick-builtin-16-9");
      await screen.findByTestId("dialog-confirm");
      await click("dialog-confirm");
      await waitFor(() => expect(width.value).toBe("16"));
      expect(screen.getByTestId("crop-ratio-width")).toBe(width);
      expect(screen.getByTestId<HTMLInputElement>("crop-position-y").value).toBe(
        screen.getByTestId("crop-frame-0").getAttribute("y"),
      );
      await user.selectOptions(presetSelect, preset.id);
      await waitFor(() => expect(presetSelect.value).toBe(preset.id));
    }
    await click("crop-preset-delete");
    await waitFor(async () =>
      expect((await api.listRatioPresets()).some((item) => item.id === preset.id)).toBe(false),
    );
  },
  20000,
);
