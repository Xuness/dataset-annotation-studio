import { createScopedViewState } from "../../shared/store/scopedViewState";
import {
  assetBrowserViewState,
  browserScopeKey,
  type AssetBrowserView,
} from "../workspace/assetBrowserState";

export interface CharacterBrowserView extends AssetBrowserView {
  operationFocus: string | null;
  reviewView: "review" | "apply";
  configProfile: number;
  assetWidth: number;
  settingsWidth: number;
  previewPercent: number;
}
export const characterBrowserState = createScopedViewState<CharacterBrowserView>((project) => ({
  ...assetBrowserViewState.get(browserScopeKey(project, "assets")),
  operationFocus: null,
  reviewView: "review",
  configProfile: 0,
  assetWidth: 260,
  settingsWidth: 300,
  previewPercent: 48,
}));
