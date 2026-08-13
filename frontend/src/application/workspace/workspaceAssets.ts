import type { AnnotationChannelTarget } from "../../shared/api/types";
import type { AnnotationBulkAction } from "../annotations/annotationBulk";

export const DEFAULT_EDITOR_TARGET: AnnotationChannelTarget = {
  channel: "description",
  language: "",
};

export type EditorDirtyKind = "tags" | "annotation" | null;
export interface AnnotationBulkDialogState {
  open: boolean;
  action: AnnotationBulkAction;
  assetIds: string[];
}

export interface TagBatchDialogState {
  open: boolean;
  assetIds: string[];
}

export const CLOSED_ANNOTATION_DIALOG: AnnotationBulkDialogState = {
  open: false,
  action: "review",
  assetIds: [],
};

export const CLOSED_TAG_BATCH_DIALOG: TagBatchDialogState = {
  open: false,
  assetIds: [],
};

export function resolveKnownMatchingAssetIds({
  loadedAssets,
  total,
  hasNextPage,
  queriedIds,
  queriedTotal,
  queriedIdsStale,
}: {
  loadedAssets: ReadonlyArray<{ id: string }>;
  total: number | undefined;
  hasNextPage: boolean;
  queriedIds: readonly string[] | undefined;
  queriedTotal: number | undefined;
  queriedIdsStale: boolean;
}): string[] | null {
  if (queriedIds && !queriedIdsStale && queriedTotal === total) return [...queriedIds];
  if (total === undefined || hasNextPage || loadedAssets.length !== total) return null;
  return loadedAssets.map((asset) => asset.id);
}

export function areAllAssetsChecked(
  matchingAssetIds: readonly string[] | null,
  checkedAssetIds: readonly string[],
): boolean {
  if (!matchingAssetIds?.length) return false;
  const checked = new Set(checkedAssetIds);
  return matchingAssetIds.every((assetId) => checked.has(assetId));
}

export function editorDiscardMessage(
  kind: EditorDirtyKind,
  destination: "asset" | "folder" | "scope",
) {
  const action =
    destination === "asset" ? "切换图片" : destination === "folder" ? "切换目录" : "切换素材范围";
  if (kind === "tags") {
    return `当前 Tags 修改尚未保存，${action}会丢弃这些修改。`;
  }
  return `当前标注尚未保存，${action}会丢弃未保存的修改。`;
}
