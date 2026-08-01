import type { AnnotationBatchTargetOption, AnnotationChannelTarget } from "../../shared/api/types";

export type AnnotationBulkAction = "review" | "delete";

export function annotationTargetKey(
  target: Pick<
    AnnotationChannelTarget,
    "channel" | "language" | "translation_source_kind" | "translation_producer_kind"
  >,
): string {
  return `${target.channel}:${target.translation_source_kind ?? ""}:${
    target.translation_producer_kind ?? ""
  }:${target.language}`;
}

export function annotationOptionKey(option: AnnotationBatchTargetOption): string {
  return annotationTargetKey({
    channel: option.channel,
    language: option.language ?? "",
    translation_source_kind: option.translation_source_kind,
    translation_producer_kind: option.translation_producer_kind,
  });
}
