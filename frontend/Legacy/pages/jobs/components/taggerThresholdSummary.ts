import type { TaggerProfile } from "../../../../src/shared/api/types";
import { taggerCategoryLabel } from "../../../../src/features/taggers/labels";

export function taggerThresholdSummary(profile: TaggerProfile): {
  label: string;
  value: string;
} {
  const { selection } = profile;
  if (selection.mode === "global") {
    return {
      label: "统一阈值",
      value: `${selection.global_threshold.toFixed(2)}（全部输出类别）`,
    };
  }

  return {
    label: selection.mode === "category" ? "有效分类阈值" : "分类回退阈值",
    value: profile.categories
      .map((category) => {
        const threshold = selection.category_thresholds[category] ?? selection.global_threshold;
        return `${taggerCategoryLabel(category)} ${threshold.toFixed(2)}`;
      })
      .join(" · "),
  };
}
