import { tagsToDraft } from "../../../../application/annotations/annotationDraft";
import { taggerCategoryLabel } from "../../../../features/taggers/labels";
import type {
  AnnotationChannel,
  AnnotationRevision,
  AnnotationTag,
  TranslationStatus,
} from "../../../../shared/api/types";
import {
  ANNOTATION_EDIT_CHANNEL_IDS,
  type AnnotationEditChannelId,
  type AnnotationEditChannelOption,
  type AnnotationEditHistoryEntry,
  type AnnotationEditTagGroup,
} from "../spacePageModel";

interface EditChannelPresentation {
  code: string;
  title: string;
  shortTitle: string;
}

export const ANNOTATION_EDIT_CHANNEL_PRESENTATION: Readonly<
  Record<AnnotationEditChannelId, EditChannelPresentation>
> = {
  existing_annotation: { code: "TXT.00", title: "原有标注", shortTitle: "原文" },
  tags: { code: "TAG.01", title: "标签", shortTitle: "Tags" },
  description: { code: "DSC.02", title: "描述", shortTitle: "描述" },
  translation: { code: "TRN.03", title: "译文", shortTitle: "译文" },
};

const AVAILABILITY_LABELS = {
  missing: "尚未建立",
  usable: "当前可用",
  stale: "依赖已变化",
  invalid: "内容异常",
} as const;

const TRANSLATION_STATUS_LABELS: Record<TranslationStatus, string> = {
  missing: "尚无译文",
  current: "源版本一致",
  source_mismatch: "需要重新校对",
  invalid: "译文异常",
  source_missing: "缺少源标注",
  source_invalid: "源标注异常",
};

const REVISION_SOURCE_LABELS: Readonly<Record<string, string>> = {
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

export function isAnnotationEditChannelId(value: unknown): value is AnnotationEditChannelId {
  return ANNOTATION_EDIT_CHANNEL_IDS.includes(value as AnnotationEditChannelId);
}

export function annotationAvailabilityLabel(status: keyof typeof AVAILABILITY_LABELS): string {
  return AVAILABILITY_LABELS[status];
}

export function annotationTranslationStatusLabel(status: TranslationStatus | undefined): string {
  return status ? TRANSLATION_STATUS_LABELS[status] : "等待源数据";
}

export function annotationRevisionSourceLabel(source: string): string {
  if (source.startsWith("legacy_history:")) {
    const original = source.slice("legacy_history:".length);
    return `旧数据库历史 · ${REVISION_SOURCE_LABELS[original] ?? original}`;
  }
  return REVISION_SOURCE_LABELS[source] ?? source;
}

function editChannelState(status: string | undefined): AnnotationEditChannelOption["state"] {
  if (status === "reviewed") return "reviewed";
  if (status === "usable" || status === "stale" || status === "invalid") return status;
  return "missing";
}

function editChannelStateLabel(state: AnnotationEditChannelOption["state"]): string {
  if (state === "reviewed") return "已复核";
  return annotationAvailabilityLabel(state);
}

export function projectAnnotationEditChannels(
  channelState: (channel: AnnotationChannel, targetLanguage?: string) => string | undefined,
  language: string,
  hasExistingAnnotation: boolean,
): AnnotationEditChannelOption[] {
  return ANNOTATION_EDIT_CHANNEL_IDS.map((id) => {
    const state = editChannelState(channelState(id, id === "translation" ? language : ""));
    const presentation = ANNOTATION_EDIT_CHANNEL_PRESENTATION[id];
    return {
      id,
      ...presentation,
      state,
      stateLabel: editChannelStateLabel(state),
      enabled: id !== "existing_annotation" || hasExistingAnnotation,
    };
  });
}

export function annotationTagCategoryLabel(category: string | null): string {
  return category ? taggerCategoryLabel(category) : "未分类";
}

function annotationTagCategoryTone(category: string | null): AnnotationEditTagGroup["tone"] {
  if (category === "character") return "accent";
  if (category === "copyright") return "sage";
  if (category === "artist" || category === "quality" || category === "year") return "warning";
  if (category === "rating") return "danger";
  return "neutral";
}

export function projectAnnotationTagGroups(
  groups: ReadonlyArray<{
    category: string | null;
    items: ReadonlyArray<{ key: string; tag: AnnotationTag }>;
  }>,
  highlightedTag: string | null,
  armedTag: string | null,
): AnnotationEditTagGroup[] {
  return groups.map((group) => ({
    id: group.category ?? "uncategorized",
    category: group.category,
    label: annotationTagCategoryLabel(group.category),
    tone: annotationTagCategoryTone(group.category),
    items: group.items.map(({ key, tag }) => ({
      key,
      name: tag.name,
      category: tag.category,
      categoryLabel: annotationTagCategoryLabel(tag.category),
      confidence: tag.confidence,
      origin: tag.origin,
      highlighted: highlightedTag === key,
      armed: armedTag === key,
    })),
  }));
}

export function projectAnnotationHistory(
  revisions: readonly AnnotationRevision[] | undefined,
  channel: AnnotationEditChannelId,
  readOnly: boolean,
): AnnotationEditHistoryEntry[] {
  return (revisions ?? []).map((revision) => ({
    id: revision.id,
    sourceLabel: annotationRevisionSourceLabel(revision.source),
    createdAt: revision.created_at,
    preview: revision.is_tombstone
      ? "已删除"
      : channel === "tags"
        ? tagsToDraft(revision.tags)
        : revision.content,
    candidate: revision.is_candidate,
    tombstone: revision.is_tombstone,
    restorable: !revision.is_tombstone && !readOnly,
  }));
}
