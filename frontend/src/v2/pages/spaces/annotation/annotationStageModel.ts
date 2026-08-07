import type { AssetSummary } from "../../../../shared/api/types";
import {
  ANNOTATION_WORKCELL_IDS,
  type AnnotationStageAsset,
  type AnnotationWorkcellId,
} from "../spacePageModel";

export function isAnnotationWorkcellId(value: unknown): value is AnnotationWorkcellId {
  return ANNOTATION_WORKCELL_IDS.includes(value as AnnotationWorkcellId);
}

export function toAnnotationStageAsset(
  asset: AssetSummary,
  imageUrl: string,
  thumbnailUrl: string,
): AnnotationStageAsset {
  return {
    id: asset.id,
    filename: asset.filename,
    relativePath: asset.relative_path,
    width: asset.width,
    height: asset.height,
    byteSize: asset.byte_size,
    suffix: asset.suffix,
    imageUrl,
    thumbnailUrl,
    annotationStatus: asset.annotation_status,
    channelStatuses: asset.annotation_channels ?? {},
  };
}

interface ResolvedStageFocus {
  asset: AnnotationStageAsset | null;
  index: number;
}

/**
 * 当前对象以稳定 asset ID 为身份。显式请求的 ID 不在已装载序列中时
 * 保持未解析状态，由控制器继续装载分页；绝不让 URL 与实际素材错位。
 */
export function resolveStageFocus(
  assets: readonly AnnotationStageAsset[],
  requestedAssetId: string | null,
  previousIndex: number,
): ResolvedStageFocus {
  if (assets.length === 0) return { asset: null, index: -1 };
  if (requestedAssetId) {
    const index = assets.findIndex((asset) => asset.id === requestedAssetId);
    if (index >= 0) return { asset: assets[index], index };
    return { asset: null, index: -1 };
  }
  const fallback = Math.min(Math.max(previousIndex, 0), assets.length - 1);
  return { asset: assets[fallback], index: fallback };
}

interface StageAssetSearchState {
  requestedAssetId: string | null;
  loadedAssetIds: readonly string[];
  hasMore: boolean;
  fetchingMore: boolean;
  loadFailed: boolean;
}

/** 深链接只在目标尚未装载且分页仍健康时继续向后解析。 */
export function shouldContinueStageAssetSearch({
  requestedAssetId,
  loadedAssetIds,
  hasMore,
  fetchingMore,
  loadFailed,
}: StageAssetSearchState): boolean {
  if (!requestedAssetId || !hasMore || fetchingMore || loadFailed) return false;
  return !loadedAssetIds.includes(requestedAssetId);
}

export function stepStageIndex(
  assets: readonly AnnotationStageAsset[],
  currentIndex: number,
  offset: number,
): AnnotationStageAsset | null {
  if (assets.length === 0) return null;
  const base = currentIndex >= 0 ? currentIndex : 0;
  const next = Math.min(Math.max(base + offset, 0), assets.length - 1);
  return assets[next] ?? null;
}

interface StageRangeToggle {
  assetIds: string[];
  checked: boolean;
}

/**
 * Shift 范围沿用上一次显式选择锚点；再次落在已选目标上时，
 * 整段执行取消，以便连续范围和 Ctrl 单项都具备可逆语义。
 */
export function resolveStageRangeToggle(
  assetIds: readonly string[],
  anchorId: string,
  targetId: string,
  checkedAssetIds: readonly string[],
): StageRangeToggle | null {
  const targetIndex = assetIds.indexOf(targetId);
  if (targetIndex < 0) return null;
  const anchorIndex = assetIds.indexOf(anchorId);
  const start = Math.min(anchorIndex < 0 ? targetIndex : anchorIndex, targetIndex);
  const end = Math.max(anchorIndex < 0 ? targetIndex : anchorIndex, targetIndex);
  return {
    assetIds: assetIds.slice(start, end + 1),
    checked: !checkedAssetIds.includes(targetId),
  };
}
