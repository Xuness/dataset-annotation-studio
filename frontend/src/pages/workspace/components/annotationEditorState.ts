export function reconcilePersistedContent(
  currentContent: string,
  submittedContent: string,
  persistedContent: string,
): string {
  return currentContent === submittedContent ? persistedContent : currentContent;
}
