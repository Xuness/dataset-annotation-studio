import { createScopedViewState } from "../../shared/store/scopedViewState";

export interface FolderTreeView {
  expandedPaths: ReadonlySet<string>;
}

export const folderTreeViewState = createScopedViewState<FolderTreeView>(() => ({
  expandedPaths: new Set([""]),
}));

export type InspectorTab = "overview" | "prompt" | "metadata";

export interface InspectorView {
  activeTab: InspectorTab;
}

export const inspectorViewState = createScopedViewState<InspectorView>(() => ({
  activeTab: "overview",
}));
