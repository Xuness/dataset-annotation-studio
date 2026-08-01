import type {
  AnnotationManualTagInput,
  AnnotationTagBatchEditRequest,
  AnnotationTagBatchOperation,
  AnnotationTagInsertPosition,
} from "../../shared/api/types";

export type TagBatchEditMode = "add" | "replace" | "remove";
export type TagBatchInsertPositionKind = AnnotationTagInsertPosition["kind"];

export interface TagBatchInsertPositionDraft {
  kind: TagBatchInsertPositionKind;
  indexDraft: string;
  anchorDraft: string;
}

export function normalizeBatchTagKey(name: string): string {
  return name.trim().toLowerCase();
}

/** Parse the same comma/newline CSV subset accepted by the single-image editor. */
export function parseBatchTagDraft(draft: string): string[] {
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

export function uniqueBatchTagNames(draft: string): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  for (const name of parseBatchTagDraft(draft)) {
    const clean = name.trim();
    const key = normalizeBatchTagKey(clean);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    names.push(clean);
  }
  return names;
}

export function makeTagBatchRequest(
  assetIds: string[],
  mode: TagBatchEditMode,
  addDraft: string,
  removeDraft: string,
  sourceDraft: string,
  replacementDraft: string,
  insertPosition: TagBatchInsertPositionDraft,
  categories: ReadonlyMap<string, string | null>,
  replacementCategory: string | null,
): { request: AnnotationTagBatchEditRequest | null; error: string | null } {
  if (!assetIds.length) return { request: null, error: "至少需要选择一张图片。" };
  let operation: AnnotationTagBatchOperation;
  if (mode === "add") {
    const names = uniqueBatchTagNames(addDraft);
    if (!names.length) return { request: null, error: "请输入至少一个要添加的 Tag。" };
    const tags: AnnotationManualTagInput[] = names.map((name) => ({
      name,
      category: categories.get(normalizeBatchTagKey(name)) ?? null,
    }));
    let position: AnnotationTagInsertPosition;
    if (insertPosition.kind === "index") {
      const value = insertPosition.indexDraft.trim();
      const oneBasedIndex = Number(value);
      if (!/^[1-9]\d*$/u.test(value) || !Number.isSafeInteger(oneBasedIndex)) {
        return { request: null, error: "第 N 位必须是大于等于 1 的整数。" };
      }
      position = { kind: "index", index: oneBasedIndex - 1 };
    } else if (insertPosition.kind === "before" || insertPosition.kind === "after") {
      const anchorName = insertPosition.anchorDraft.trim();
      if (!anchorName) return { request: null, error: "请输入用于定位的 Tag。" };
      position = { kind: insertPosition.kind, anchor_name: anchorName };
    } else {
      position = { kind: insertPosition.kind };
    }
    operation = { kind: "add", tags, position };
  } else if (mode === "remove") {
    const names = uniqueBatchTagNames(removeDraft);
    if (!names.length) return { request: null, error: "请输入至少一个要删除的 Tag。" };
    operation = { kind: "remove", tag_names: names };
  } else {
    const sources = uniqueBatchTagNames(sourceDraft);
    const replacements = uniqueBatchTagNames(replacementDraft);
    if (sources.length !== 1) {
      return { request: null, error: "替换来源只能填写一个 Tag。" };
    }
    if (replacements.length !== 1) {
      return { request: null, error: "替换目标只能填写一个 Tag。" };
    }
    if (normalizeBatchTagKey(sources[0]) === normalizeBatchTagKey(replacements[0])) {
      return { request: null, error: "替换前后的 Tag 不能相同。" };
    }
    operation = {
      kind: "replace",
      source_name: sources[0],
      replacement: {
        name: replacements[0],
        category: replacementCategory,
      },
    };
  }
  return { request: { asset_ids: [...assetIds], operation }, error: null };
}
