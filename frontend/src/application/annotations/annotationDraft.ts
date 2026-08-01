import type { AnnotationTag } from "../../shared/api/types";

export function reconcilePersistedContent(
  currentContent: string,
  submittedContent: string,
  persistedContent: string,
): string {
  return currentContent === submittedContent ? persistedContent : currentContent;
}

export function hasExistingAnnotationDocument(
  documents: ReadonlyArray<{ channel: string; exists: boolean }> | undefined,
): boolean {
  return Boolean(
    documents?.some((document) => document.channel === "existing_annotation" && document.exists),
  );
}

function encodeTagName(name: string): string {
  if (name.trim() === name && !/[",\r\n]/u.test(name)) return name;
  return `"${name.replaceAll('"', '""')}"`;
}

export function tagsToDraft(tags: ReadonlyArray<AnnotationTag>): string {
  return tags.map((tag) => encodeTagName(tag.name)).join(", ");
}
