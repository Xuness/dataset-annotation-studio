import { taggerCategoryLabel } from "../../../features/taggers/labels";
import type { AnnotationTag } from "../../../shared/api/types";

export function tagCategoryLabel(category: string | null): string {
  return category ? taggerCategoryLabel(category) : "未分类";
}

export function tagCategoryTone(category: string | null): string {
  if (category === "character") return "accent";
  if (category === "copyright") return "sage";
  if (category === "artist" || category === "quality" || category === "year") return "warning";
  if (category === "rating") return "danger";
  return "neutral";
}

export function annotationTagTitle(tag: AnnotationTag): string {
  const details = [`类别：${tagCategoryLabel(tag.category)}`];
  if (tag.confidence !== null) {
    details.push(`置信度：${(tag.confidence * 100).toFixed(1)}%`);
  }
  details.push(`来源：${tag.origin.includes("tagger") ? "模型推理" : "手动编辑"}`);
  return details.join(" · ");
}
