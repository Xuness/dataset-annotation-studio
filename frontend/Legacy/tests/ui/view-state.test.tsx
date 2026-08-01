import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { annotationEditorViewState } from "../../../src/application/annotations/annotationEditorState";
import { exportWorkbenchState } from "../../../src/application/exports/exportState";
import {
  jobCenterViewState,
  reconcileSelectedJobId,
} from "../../../src/application/jobs/jobCenterState";
import { preprocessWorkbenchState } from "../../../src/application/preprocessing/preprocessState";
import {
  assetBrowserViewState,
  browserScopeKey,
} from "../../../src/application/workspace/assetBrowserState";
import { folderTreeViewState, inspectorViewState } from "../../pages/workspace/workspaceViewState";

const PROJECT_A = "view-state-project-a";
const PROJECT_B = "view-state-project-b";
const ASSETS_SCOPE_A = browserScopeKey(PROJECT_A, "assets");
const REVIEW_SCOPE_A = browserScopeKey(PROJECT_A, "review");

beforeEach(() => window.localStorage.clear());

afterEach(() => {
  cleanup();
  assetBrowserViewState.reset(ASSETS_SCOPE_A);
  assetBrowserViewState.reset(REVIEW_SCOPE_A);
  annotationEditorViewState.reset(PROJECT_A);
  annotationEditorViewState.reset(PROJECT_B);
  folderTreeViewState.reset(PROJECT_A);
  folderTreeViewState.reset(PROJECT_B);
  inspectorViewState.reset(PROJECT_A);
  inspectorViewState.reset(PROJECT_B);
  jobCenterViewState.reset(PROJECT_A);
  jobCenterViewState.reset(PROJECT_B);
  preprocessWorkbenchState.reset(PROJECT_A);
  preprocessWorkbenchState.reset(PROJECT_B);
  exportWorkbenchState.reset(PROJECT_A);
  exportWorkbenchState.reset(PROJECT_B);
});

describe("session-scoped workspace view state", () => {
  test("restores each asset browser mode after its component remounts", () => {
    const firstMount = renderHook(() => assetBrowserViewState.useValue(ASSETS_SCOPE_A));

    expect(firstMount.result.current).toMatchObject({
      search: "",
      statusFilter: null,
      folderPath: "",
      selectedAssetId: null,
    });

    act(() => {
      assetBrowserViewState.patch(ASSETS_SCOPE_A, {
        search: "portrait",
        statusFilter: "valid",
        folderPath: "characters/main",
        selectedAssetId: "asset-42",
      });
    });
    expect(firstMount.result.current).toMatchObject({
      search: "portrait",
      statusFilter: "valid",
      folderPath: "characters/main",
      selectedAssetId: "asset-42",
    });

    firstMount.unmount();
    const secondMount = renderHook(() => assetBrowserViewState.useValue(ASSETS_SCOPE_A));
    expect(secondMount.result.current.selectedAssetId).toBe("asset-42");
    expect(secondMount.result.current.folderPath).toBe("characters/main");

    const review = renderHook(() => assetBrowserViewState.useValue(REVIEW_SCOPE_A));
    expect(review.result.current).toMatchObject({
      search: "",
      statusFilter: "needs_review",
      folderPath: "",
      selectedAssetId: null,
    });
  });

  test("keeps editor, folder-tree, and inspector choices isolated by project", () => {
    const view = renderHook(() => ({
      editor: annotationEditorViewState.useValue(PROJECT_A),
      folderTree: folderTreeViewState.useValue(PROJECT_A),
      inspector: inspectorViewState.useValue(PROJECT_A),
    }));

    act(() => {
      annotationEditorViewState.patch(PROJECT_A, {
        mode: "translation",
        language: "fr",
        translationSourceKind: "tags",
        translationProducerKind: "local_dictionary",
      });
      folderTreeViewState.patch(PROJECT_A, {
        expandedPaths: new Set(["", "characters", "characters/main"]),
      });
      inspectorViewState.patch(PROJECT_A, { activeTab: "metadata" });
    });

    expect(view.result.current.editor).toMatchObject({
      mode: "translation",
      language: "fr",
      translationSourceKind: "tags",
      translationProducerKind: "local_dictionary",
    });
    expect([...view.result.current.folderTree.expandedPaths]).toEqual([
      "",
      "characters",
      "characters/main",
    ]);
    expect(view.result.current.inspector.activeTab).toBe("metadata");

    expect(annotationEditorViewState.get(PROJECT_B).mode).toBe("description");
    expect([...folderTreeViewState.get(PROJECT_B).expandedPaths]).toEqual([""]);
    expect(inspectorViewState.get(PROJECT_B).activeTab).toBe("overview");
  });

  test("retains task and form work without writing process state to localStorage", () => {
    act(() => {
      jobCenterViewState.patch(PROJECT_A, { selectedJobId: "job-7" });
      preprocessWorkbenchState.patch(PROJECT_A, (current) => ({
        form: {
          ...current.form,
          scope: "selected",
          maxEdge: 1536,
          renameTemplate: "sample_{index}",
        },
        selectedOperationId: "operation-3",
      }));
      exportWorkbenchState.patch(PROJECT_A, (current) => ({
        form: {
          ...current.form,
          destinationPath: "D:\\exports\\dataset",
          formats: ["txt", "json"],
          packaging: "zip",
        },
      }));
    });

    expect(jobCenterViewState.get(PROJECT_A).selectedJobId).toBe("job-7");
    expect(preprocessWorkbenchState.get(PROJECT_A)).toMatchObject({
      form: {
        scope: "selected",
        maxEdge: 1536,
        renameTemplate: "sample_{index}",
      },
      selectedOperationId: "operation-3",
    });
    expect(exportWorkbenchState.get(PROJECT_A).form).toMatchObject({
      destinationPath: "D:\\exports\\dataset",
      formats: ["txt", "json"],
      packaging: "zip",
    });

    expect(jobCenterViewState.get(PROJECT_B).selectedJobId).toBeNull();
    expect(preprocessWorkbenchState.get(PROJECT_B).form.maxEdge).toBe(2048);
    expect(exportWorkbenchState.get(PROJECT_B).form.destinationPath).toBe("");
    expect(window.localStorage.length).toBe(0);
  });

  test("does not discard a remembered job while older history is still unloaded", () => {
    expect(reconcileSelectedJobId("job-older", ["job-newest"], true)).toBe("job-older");
    expect(reconcileSelectedJobId("job-older", ["job-newest"], false)).toBe("job-newest");
    expect(reconcileSelectedJobId(null, ["job-newest"], true)).toBe("job-newest");
  });
});
