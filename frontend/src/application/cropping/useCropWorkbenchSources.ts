import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { selectedCropSources, scopedCropSources } from "../../features/cropping/workbenchApi";
import { useWorkspaceSelectionStore } from "../../shared/store/workspaceSelectionStore";
import { workspaceQueryKeys } from "../../shared/query/workspaceQueries";
import type { WorkspaceBrowserMode } from "../workspace/assetBrowserState";
import { cropBrowserKey, cropBrowserState } from "./cropBrowserState";
import {
  cropScopeKey,
  cropWorkbenchState,
  reconcileSources,
  type CropMode,
} from "./workbenchState";
import type { CropScopeRequest } from "../../shared/api/types";

export function useCropWorkbenchSources(
  project: string,
  mode: CropMode,
  browserMode: WorkspaceBrowserMode,
  focus: string | null,
  entry: string | null,
) {
  const key = cropScopeKey(project, mode);
  const state = cropWorkbenchState.useValue(key);
  const selection = useWorkspaceSelectionStore();
  const checked = selection.projectId === project ? selection.checkedAssetIds : [];
  const browser = cropBrowserState.useValue(cropBrowserKey(project, mode, browserMode));
  const focusToken = focus ? `${focus}:${entry ?? ""}` : null;
  const ids =
    mode === "single" && focus && !checked.includes(focus) && browser.overriddenEntry !== focusToken
      ? [focus]
      : checked;
  const request: CropScopeRequest = {
    scope: state.scope,
    asset_ids: state.scope === "selected" ? checked : [],
    filters: {
      search: state.scope === "filtered" ? browser.search : "",
      status: state.scope === "filtered" ? browser.statusFilter : null,
      folder_path:
        state.scope === "folder"
          ? state.folder
          : state.scope === "filtered"
            ? browser.folderPath
            : "",
    },
  };
  const query = useQuery({
    queryKey: [
      ...workspaceQueryKeys.scope(project, "assets"),
      "crop-workbench-sources",
      mode,
      mode === "single" && state.scope === "selected" ? ids : request,
    ],
    queryFn: () => {
      if (mode === "single" && state.scope === "selected")
        return ids.length ? selectedCropSources(project, ids) : Promise.resolve([]);
      if (
        (request.scope === "selected" && !checked.length) ||
        (request.scope === "folder" && !state.folder)
      )
        return Promise.resolve([]);
      return scopedCropSources(project, request);
    },
    enabled: Boolean(project),
  });
  useEffect(() => {
    if (!query.data) return;
    cropWorkbenchState.patch(key, (current) =>
      reconcileSources(current, query.data, mode, mode === "single" ? focus : null, entry),
    );
  }, [query.data, key, mode, focus, entry]);
  return {
    query,
    checkedCount: checked.length,
    fromFocusedAsset: mode === "single" && state.scope === "selected" && ids !== checked,
  };
}
