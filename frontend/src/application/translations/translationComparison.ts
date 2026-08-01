import type {
  AnnotationTag,
  TagDictionaryResolution,
  TokenCountRequestItem,
  TranslationAlignmentPart,
  TranslationDocument,
} from "../../shared/api/types";

interface BuildTranslationComparisonModelOptions {
  translation: TranslationDocument | undefined;
  editing: boolean;
  editContent: string;
  editorTags: readonly AnnotationTag[] | undefined;
  editorTagsDirty: boolean;
  dictionaryPreview: TagDictionaryResolution | undefined;
  dictionaryPreviewLoading: boolean;
  dictionaryPreviewError: unknown;
}

export interface TranslationComparisonModel {
  identityKey: string;
  isTags: boolean;
  tags: AnnotationTag[];
  persistedAligned: boolean;
  previewAligned: boolean;
  aligned: boolean;
  persistedTagParts: TranslationAlignmentPart[];
  canRenderPersistedTags: boolean;
  hasSource: boolean;
  canRenderDescription: boolean;
  sourceContent: string;
  translatedContent: string;
  mismatch: boolean;
  tokenCountItems: TokenCountRequestItem[];
}

export function buildTranslationComparisonModel({
  translation,
  editing,
  editContent,
  editorTags,
  editorTagsDirty,
  dictionaryPreview,
  dictionaryPreviewLoading,
  dictionaryPreviewError,
}: BuildTranslationComparisonModelOptions): TranslationComparisonModel {
  const isTags = translation?.source_kind === "tags";
  const fallbackTags =
    translation?.source_tags.length || !isTags
      ? (translation?.source_tags ?? [])
      : (translation?.alignment_parts
          .filter((part) => part.kind === "tag")
          .map((part) => ({
            name: part.source_text,
            category: part.category,
            confidence: part.confidence,
            origin: "translation_source",
          })) ?? []);
  const tags = [...(editorTags ?? fallbackTags)];
  const tagSignature = tags
    .map((tag) => `${tag.name.trim().toLowerCase()}:${tag.category ?? ""}`)
    .join("\u0000");
  const persistedAligned =
    !editing && translation?.status === "current" && translation.alignment_status === "aligned";
  const previewAligned = Boolean(
    isTags &&
    translation?.producer_kind === "local_dictionary" &&
    dictionaryPreview?.entries.length === tags.length,
  );
  const aligned = Boolean(persistedAligned || previewAligned);
  const persistedTagParts =
    translation?.alignment_parts.filter((part) => part.kind === "tag") ?? [];
  const canRenderPersistedTags = Boolean(
    !editorTagsDirty && persistedAligned && persistedTagParts.length === tags.length,
  );
  const hasSource = Boolean(translation?.source_exists);
  const canRenderDescription = Boolean(
    !isTags && persistedAligned && translation?.alignment_parts.length,
  );
  const sourceContent = translation?.source_content ?? "";
  const translatedContent = translation?.content ?? "";
  const mismatch = translation?.status === "source_mismatch";
  const sourceTokenText = hasSource
    ? isTags
      ? tags.map((tag) => tag.name).join("\n")
      : sourceContent
    : null;
  const persistedTranslationTokenText =
    !mismatch && translation?.status !== "missing"
      ? isTags && canRenderPersistedTags
        ? persistedTagParts
            .map((part) => part.translated_text)
            .filter(Boolean)
            .join("\n")
        : translatedContent || null
      : null;
  let translatedTokenText: string | null = null;
  if (translation && editing && hasSource) {
    translatedTokenText = editContent;
  } else if (
    translation &&
    !(isTags && editorTagsDirty && translation.producer_kind !== "local_dictionary")
  ) {
    if (isTags && translation.producer_kind === "local_dictionary") {
      if (tags.length > 0 && !dictionaryPreviewLoading && !dictionaryPreviewError) {
        translatedTokenText = previewAligned
          ? (dictionaryPreview?.entries
              .map((entry) => entry.translation ?? entry.requested_tag)
              .filter(Boolean)
              .join("\n") ?? null)
          : persistedTranslationTokenText;
      }
    } else {
      translatedTokenText = persistedTranslationTokenText;
    }
  }
  const tokenCountItems: TokenCountRequestItem[] = [];
  if (sourceTokenText !== null) tokenCountItems.push({ id: "source", text: sourceTokenText });
  if (translatedTokenText !== null) {
    tokenCountItems.push({ id: "translated", text: translatedTokenText });
  }

  return {
    identityKey: [
      translation?.asset_id ?? "",
      translation?.language ?? "",
      translation?.source_kind ?? "",
      translation?.producer_kind ?? "",
      translation?.modified_at ?? "",
      tagSignature,
      editing ? "editing" : "reading",
    ].join(":"),
    isTags,
    tags,
    persistedAligned,
    previewAligned,
    aligned,
    persistedTagParts,
    canRenderPersistedTags,
    hasSource,
    canRenderDescription,
    sourceContent,
    translatedContent,
    mismatch,
    tokenCountItems,
  };
}

export function uniqueAlignmentIds(ids: readonly string[]): string[] {
  return Array.from(new Set(ids.filter(Boolean)));
}
