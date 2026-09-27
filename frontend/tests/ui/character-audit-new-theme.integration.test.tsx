import { useState, type ComponentType } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { afterAll, beforeAll, expect, test, vi } from "vitest";

import { CharacterAuditPage } from "../../src/v2/themes/dial-archive/spaces/character-audits/CharacterAuditPage";

import {
  startCharacterAuditServer,
  type CharacterAuditTestServer,
  type CharacterAuditServerInfo,
} from "../characterAuditServer";
import { clickControl, exerciseCharacterAuditReview } from "../characterAuditFlow";

let server: CharacterAuditTestServer;
let info: CharacterAuditServerInfo;
let Harness: ComponentType;
let queryClient: QueryClient;
let readBundle: (typeof import("../../src/features/annotations/api"))["getAnnotationBundle"];

beforeAll(async () => {
  server = await startCharacterAuditServer();
  info = server.info;
  vi.stubEnv("VITE_API_BASE_URL", info.base_url);
  const { getSystemDiagnostics } = await import("../../src/features/system/api");
  expect((await getSystemDiagnostics()).status).toBe("ok");
  readBundle = (await import("../../src/features/annotations/api")).getAnnotationBundle;
  const { useCharacterAuditController } =
    await import("../../src/application/characterAudits/useCharacterAuditController");
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  Harness = function AuditHarness() {
    const [operationId, setOperationId] = useState<string | null>(info.draft_id);
    const content = useCharacterAuditController({
      confirm: async ({ message }) => window.confirm(message),
      projectId: info.project_id,
      operationId,
      onSelectOperation: setOperationId,
      onReturnToAnnotation: () => setOperationId(null),
      onOpenPrerequisite: () => {
        throw new Error("Unexpected prerequisite navigation");
      },
    });
    return <CharacterAuditPage content={content} />;
  };
}, 30_000);

afterAll(async () => {
  cleanup();
  queryClient?.clear();
  vi.unstubAllEnvs();
  if (server) await server.stop();
});

test("real API: configure, stop/resume, edit, resolve shared-image conflicts and atomically apply", async () => {
  render(
    <QueryClientProvider client={queryClient}>
      <Harness />
    </QueryClientProvider>,
  );
  await exerciseCharacterAuditReview(info);
  // Only the browser confirmation is accepted; all reads and writes use the real API.
  const confirmation = vi.spyOn(window, "confirm").mockReturnValue(true);
  await clickControl("character-apply");
  await screen.findByTestId("character-applied");
  confirmation.mockRestore();
  const bundle = await readBundle(info.project_id, info.reference_id);
  const tags = bundle.documents.find((document) => document.channel === "tags");
  expect(tags?.review_status).toBe("unreviewed");
  expect(tags?.tags.some((tag) => tag.name === "red hair")).toBe(true);
  cleanup();
  render(
    <QueryClientProvider client={queryClient}>
      <Harness />
    </QueryClientProvider>,
  );
  await screen.findByTestId("character-start");
  await clickControl(`character-open-${info.review_id}`);
  await screen.findByTestId("character-applied");
}, 25_000);
