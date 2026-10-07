import { createScopedViewState } from "../../shared/store/scopedViewState";
import {
  assetBrowserViewState,
  browserScopeKey,
  type AssetBrowserView,
  type WorkspaceBrowserMode,
} from "../workspace/assetBrowserState";
import type { CropMode } from "./workbenchState";

interface CropBrowserView extends AssetBrowserView {
  overriddenEntry: string | null;
}
export function cropBrowserKey(
  project: string,
  mode: CropMode,
  browser: WorkspaceBrowserMode,
): string {
  return `${project}:${mode}:${browser}`;
}
export const cropBrowserState = createScopedViewState<CropBrowserView>((key) => {
  const [project, , browser] = key.split(":");
  return {
    ...assetBrowserViewState.get(
      browserScopeKey(project, browser === "review" ? "review" : "assets"),
    ),
    overriddenEntry: null,
  };
});
