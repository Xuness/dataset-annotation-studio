import type {
  AnnotationAvailabilityStatus,
  AnnotationReviewStatus,
  TranslationStatus,
} from "../../../shared/api/types";

const revisionSourceLabels: Record<string, string> = {
  manual_edit: "手动保存",
  manual_tag_batch_add: "批量添加 Tags",
  manual_tag_batch_remove: "批量删除 Tags",
  manual_tag_batch_replace: "批量替换 Tags",
  model_response: "LLM 生成",
  local_tagger: "Tagger 生成",
  manual_accept: "人工采用",
  manual_reconfirm: "图片变化后复核",
  manual_review_current_image: "复核并关联当前图片",
  manual_review_current_source: "复核并关联当前源标注",
  manual_delete: "删除",
  legacy_txt_import: "旧 TXT 导入",
};

export const REVIEW_LABELS: Record<AnnotationReviewStatus, string> = {
  unreviewed: "尚未复核",
  reviewed: "已复核",
};

export const AVAILABILITY_LABELS: Record<AnnotationAvailabilityStatus, string> = {
  missing: "缺失",
  usable: "当前可用",
  invalid: "内容无效",
  stale: "图片或依赖内容已变化",
};

export const TRANSLATION_STATUS_LABELS: Record<TranslationStatus, string> = {
  missing: "尚无译文",
  current: "译文源版本一致",
  source_mismatch: "当前不匹配",
  invalid: "译文内容无效",
  source_missing: "缺少当前可用的源标注",
  source_invalid: "当前源标注无效",
};

export function revisionSourceLabel(source: string): string {
  if (source.startsWith("legacy_history:")) {
    const original = source.slice("legacy_history:".length);
    return `旧数据库历史 · ${revisionSourceLabels[original] ?? original}`;
  }
  return revisionSourceLabels[source] ?? source;
}
