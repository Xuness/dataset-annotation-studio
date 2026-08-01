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

export const CLOSED_ANNOTATION_DIALOG: AnnotationBulkDialogState = {
  open: false,
  action: "review",
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

export function editorDiscardMessage(kind: EditorDirtyKind, destination: "asset" | "folder") {
  if (kind === "tags") {
    return destination === "asset"
      ? "当前 Tags 修改尚未保存，切换图片会丢弃这些修改。"
      : "当前 Tags 修改尚未保存，切换目录会丢弃这些修改。";
  }
  return destination === "asset"
    ? "当前标注尚未保存，切换图片会丢弃未保存的修改。"
    : "当前标注尚未保存，切换目录会丢弃未保存的修改。";
}
