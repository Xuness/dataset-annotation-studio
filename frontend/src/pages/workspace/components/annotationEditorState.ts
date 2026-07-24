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
