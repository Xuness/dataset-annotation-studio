import type {
  AnnotationChannel,
  AssetFilterStatus,
  TranslationProducerKind,
  TranslationSourceKind,
} from "../../shared/api/types";
import { createScopedViewState } from "../../shared/store/scopedViewState";

export type WorkspaceBrowserMode = "assets" | "review";

export function browserScopeKey(projectId: string, mode: WorkspaceBrowserMode): string {
  return `${projectId}:${mode}`;
}

export interface AssetBrowserView {
  search: string;
  statusFilter: AssetFilterStatus | null;
  folderPath: string;
  selectedAssetId: string | null;
}

export const assetBrowserViewState = createScopedViewState<AssetBrowserView>((scope) => ({
  search: "",
  statusFilter: scope.endsWith(":review") ? "needs_review" : null,
  folderPath: "",
  selectedAssetId: null,
}));

export interface AnnotationEditorView {
  mode: AnnotationChannel;
  language: string;
  translationSourceKind: TranslationSourceKind;
  translationProducerKind: TranslationProducerKind;
}

export const annotationEditorViewState = createScopedViewState<AnnotationEditorView>(() => ({
  mode: "description",
  language: "zh-CN",
  translationSourceKind: "description",
  translationProducerKind: "llm",
}));

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
