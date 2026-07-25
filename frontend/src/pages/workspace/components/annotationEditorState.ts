import type { AnnotationTag } from "../../../shared/api/types";

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

export function parseTagDraft(draft: string): string[] {
  const values: string[] = [];
  let field = "";
  let quoted = false;
  let inQuotes = false;
  let afterClosingQuote = false;

  function commit() {
    const value = quoted ? field : field.trim();
    if (value) values.push(value);
    field = "";
    quoted = false;
    inQuotes = false;
    afterClosingQuote = false;
  }

  for (let index = 0; index < draft.length; index += 1) {
    const character = draft[index];
    if (inQuotes) {
      if (character === '"' && draft[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        inQuotes = false;
        afterClosingQuote = true;
      } else {
        field += character;
      }
      continue;
    }
    if (character === '"' && !field.trim()) {
      field = "";
      quoted = true;
      inQuotes = true;
      continue;
    }
    if (character === "," || character === "\n" || character === "\r") {
      commit();
      if (character === "\r" && draft[index + 1] === "\n") index += 1;
      continue;
    }
    if (afterClosingQuote && /\s/u.test(character)) continue;
    afterClosingQuote = false;
    field += character;
  }
  commit();
  return values;
}

export function draftToTags(
  draft: string,
  previous: ReadonlyArray<AnnotationTag>,
): AnnotationTag[] {
  const existing = new Map(previous.map((tag) => [tag.name.toLowerCase(), tag]));
  const seen = new Set<string>();
  const result: AnnotationTag[] = [];
  for (const name of parseTagDraft(draft)) {
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(
      existing.has(key)
        ? { ...existing.get(key)!, name }
        : {
            name,
            category: null,
            confidence: null,
            origin: "manual",
          },
    );
  }
  return result;
}
