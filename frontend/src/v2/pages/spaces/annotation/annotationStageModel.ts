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
 * 当前对象以稳定 asset ID 为身份。请求的 ID 不在已装载序列中时保持
 * 此前的索引位置（序列窗口滚动后的最近可见项），绝不悄悄回退到第一张。
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
  }
  const fallback = Math.min(Math.max(previousIndex, 0), assets.length - 1);
  return { asset: assets[fallback], index: fallback };
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
