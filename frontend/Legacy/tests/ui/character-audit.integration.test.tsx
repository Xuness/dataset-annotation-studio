import type { ComponentType } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterAll, beforeAll, expect, test, vi } from "vitest";

import {
  startCharacterAuditServer,
  type CharacterAuditTestServer,
} from "../../../tests/characterAuditServer";
import { clickControl, exerciseCharacterAuditReview } from "../../../tests/characterAuditFlow";

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
  await clickControl("workspace-nav-characters");
  await screen.findByTestId("legacy-character-workbench");
  await clickControl(`character-open-${info.review_id}`);
  await screen.findByTestId("character-reason-0");
  fireEvent.change(screen.getByTestId("character-reason-0"), {
    target: { value: "Unsaved human decision" },
  });
  await clickControl("workspace-nav-jobs");
  await screen.findByTestId("dialog-cancel");
  await clickControl("dialog-cancel");
  expect(screen.getByTestId<HTMLTextAreaElement>("character-reason-0").value).toBe(
    "Unsaved human decision",
  );
  await clickControl(`character-open-${info.draft_id}`);
  await screen.findByTestId("dialog-confirm");
  await clickControl("dialog-confirm");
  await exerciseCharacterAuditReview(info);
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
