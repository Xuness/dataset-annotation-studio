import type { AnnotationTag } from "../../../shared/api/types";

export const TAG_CATEGORY_ORDER = [
  "character",
  "copyright",
  "artist",
  "general",
  "quality",
  "rating",
  "year",
  "meta",
  "unknown",
] as const;

export interface TagGroupItem {
  key: string;
  index: number;
  tag: AnnotationTag;
}

export interface TagGroup {
  category: string | null;
  items: TagGroupItem[];
}

export interface AppendTagsResult {
  tags: AnnotationTag[];
  duplicateKey: string | null;
  addedCount: number;
}

export function normalizeTagKey(name: string): string {
  return name.trim().toLowerCase();
}

export function annotationTagsEqual(
  first: ReadonlyArray<AnnotationTag>,
  second: ReadonlyArray<AnnotationTag>,
): boolean {
  return (
    first.length === second.length &&
    first.every((tag, index) => {
      const other = second[index];
      return (
        tag.name === other.name &&
        tag.category === other.category &&
        tag.confidence === other.confidence &&
        tag.origin === other.origin
      );
    })
  );
}

export function reconcilePersistedTags(
  current: ReadonlyArray<AnnotationTag>,
  submitted: ReadonlyArray<AnnotationTag>,
  persisted: ReadonlyArray<AnnotationTag>,
): AnnotationTag[] {
  return annotationTagsEqual(current, submitted) ? [...persisted] : [...current];
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

export function appendManualTags(
  current: ReadonlyArray<AnnotationTag>,
  draft: string,
): AppendTagsResult {
  return appendTags(
    current,
    parseTagDraft(draft).map((name) => ({
      name,
      category: null,
      confidence: null,
      origin: "manual",
    })),
  );
}

export function appendVocabularyTag(
  current: ReadonlyArray<AnnotationTag>,
  item: Pick<AnnotationTag, "name" | "category">,
): AppendTagsResult {
  return appendTags(current, [
    {
      name: item.name,
      category: item.category,
      confidence: null,
      origin: "manual",
    },
  ]);
}

export function removeTag(current: ReadonlyArray<AnnotationTag>, key: string): AnnotationTag[] {
  return current.filter((tag) => normalizeTagKey(tag.name) !== key);
}

export function groupTags(tags: ReadonlyArray<AnnotationTag>): TagGroup[] {
  const groups = new Map<string, TagGroup>();
  tags.forEach((tag, index) => {
    const category = tag.category?.trim().toLowerCase() || null;
    const groupKey = category ?? "";
    const group = groups.get(groupKey) ?? { category, items: [] };
    group.items.push({
      key: normalizeTagKey(tag.name),
      index,
      tag,
    });
    groups.set(groupKey, group);
  });
  const categoryOrder = new Map<string, number>(
    TAG_CATEGORY_ORDER.map((category, index) => [category, index]),
  );
  return [...groups.values()].sort((first, second) => {
    if (first.category === null) return second.category === null ? 0 : 1;
    if (second.category === null) return -1;
    const firstOrder = categoryOrder.get(first.category);
    const secondOrder = categoryOrder.get(second.category);
    if (firstOrder !== undefined || secondOrder !== undefined) {
      return (firstOrder ?? TAG_CATEGORY_ORDER.length) - (secondOrder ?? TAG_CATEGORY_ORDER.length);
    }
    return first.category.localeCompare(second.category);
  });
}

function appendTags(
  current: ReadonlyArray<AnnotationTag>,
  candidates: ReadonlyArray<AnnotationTag>,
): AppendTagsResult {
  const tags = [...current];
  const seen = new Set(tags.map((tag) => normalizeTagKey(tag.name)));
  let duplicateKey: string | null = null;
  let addedCount = 0;
  for (const candidate of candidates) {
    const key = normalizeTagKey(candidate.name);
    if (!key) continue;
    if (seen.has(key)) {
      duplicateKey ??= key;
      continue;
    }
    seen.add(key);
    tags.push({ ...candidate, name: candidate.name.trim() });
    addedCount += 1;
  }
  return { tags, duplicateKey, addedCount };
}
