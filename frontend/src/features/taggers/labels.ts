import type { TaggerDevice, TaggerSelectionMode } from "../../shared/api/types";

export const TAGGER_CATEGORY_LABELS: Record<string, string> = {
  character: "角色",
  general: "通用",
  copyright: "作品",
  artist: "画师",
  meta: "元信息",
  rating: "分级",
  year: "年份",
  quality: "质量",
  unknown: "其它",
};

export const TAGGER_DEVICE_LABELS: Record<TaggerDevice, string> = {
  auto: "自动选择",
  cpu: "CPU",
  cuda: "NVIDIA CUDA",
  directml: "DirectML",
};

export const TAGGER_SELECTION_MODE_LABELS: Record<TaggerSelectionMode, string> = {
  global: "统一阈值",
  category: "分类阈值",
  model_recommended: "模型逐标签推荐",
};

export function taggerCategoryLabel(category: string): string {
  return TAGGER_CATEGORY_LABELS[category] ?? category;
}

export function taggerSelectionModeLabel(mode: string | null | undefined): string {
  if (mode && mode in TAGGER_SELECTION_MODE_LABELS) {
    return TAGGER_SELECTION_MODE_LABELS[mode as TaggerSelectionMode];
  }
  return mode || "未记录";
}
