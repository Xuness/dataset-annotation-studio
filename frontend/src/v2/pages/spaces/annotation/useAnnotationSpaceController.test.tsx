import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { useAssets } from "../../../../features/assets/hooks";
import { annotationStageViewState } from "./annotationStageState";
import { useAnnotationSpaceController } from "./useAnnotationSpaceController";

const { pendingQuery } = vi.hoisted(() => ({
  pendingQuery: () => ({
    data: undefined,
    error: null,
    isError: false,
    isPending: true,
  }),
}));

vi.mock("../../../../features/annotations/hooks", () => ({
  useAnnotationOverview: vi.fn(pendingQuery),
}));

vi.mock("../../../../features/assets/hooks", () => ({
  useAssets: vi.fn(pendingQuery),
}));

vi.mock("../../../../features/jobs/hooks", () => ({
  useJobHistory: vi.fn(pendingQuery),
}));

vi.mock("../../../../features/presets/hooks", () => ({
  useProviderProfiles: vi.fn(pendingQuery),
  useSystemPresets: vi.fn(pendingQuery),
  useTranslationPromptPresets: vi.fn(pendingQuery),
}));

vi.mock("../../../../features/tagDictionaries/hooks", () => ({
  useTagDictionaryLibrary: vi.fn(pendingQuery),
}));

vi.mock("../../../../features/taggers/hooks", () => ({
  useTaggerLibrary: vi.fn(pendingQuery),
}));

vi.mock("../../../../features/workspaces/hooks", () => ({
  useWorkspace: vi.fn(pendingQuery),
}));

const projectId = "project-scope-regression";

describe("annotation space controller material scope", () => {
  beforeEach(() => {
    annotationStageViewState.reset(projectId);
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
    annotationStageViewState.reset(projectId);
  });

  test("restores the selected folders when the annotation space is entered again", () => {
    annotationStageViewState.patch(projectId, { folderPaths: ["2025", "2026"] });
    const options = {
      projectId,
      onOpenArchive: vi.fn(),
      onOpenWorkbench: vi.fn(),
      onOpenProduction: vi.fn(),
    };

    const firstVisit = renderHook(() => useAnnotationSpaceController(options));
    expect(useAssets).toHaveBeenLastCalledWith(projectId, {
      folderPaths: ["2025", "2026"],
      limit: 7,
    });
    firstVisit.unmount();

    renderHook(() => useAnnotationSpaceController(options));
    expect(useAssets).toHaveBeenLastCalledWith(projectId, {
      folderPaths: ["2025", "2026"],
      limit: 7,
    });
  });
});
