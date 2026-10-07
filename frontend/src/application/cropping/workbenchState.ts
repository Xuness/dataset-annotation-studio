import type { CropSource, CropRect, Ratio, CropScopeRequest } from "../../shared/api/types";
import { createScopedViewState } from "../../shared/store/scopedViewState";
import { centeredRect } from "./geometry";

export type CropMode = "single" | "batch";
export type CropView = "editor" | "overview";
export interface RegionDraft {
  id: string;
  rectangle: CropRect;
  generated: { signature: string; operationId: string } | null;
  failure: string | null;
  touched: boolean;
}
export interface SourceDraft {
  source: CropSource;
  regions: RegionDraft[];
  selected: number;
  invalid: boolean;
  sourceError: string | null;
}
export interface WorkbenchState {
  sourceIds: string[];
  drafts: Record<string, SourceDraft>;
  activeId: string | null;
  focusToken: string | null;
  view: CropView;
  ratio: Ratio;
  ratioValid: boolean;
  ratioRevision: number;
  scope: CropScopeRequest["scope"];
  folder: string;
  sourcePage: number;
  overviewPage: number;
  phase: "idle" | "previewing" | "confirming" | "executing" | "undoing";
  error: string | null;
}
export function cropScopeKey(project: string, mode: CropMode): string {
  return `${project}:${mode}`;
}
export const cropWorkbenchState = createScopedViewState<WorkbenchState>((scope) => ({
  sourceIds: [],
  drafts: {},
  activeId: null,
  focusToken: null,
  view: scope.endsWith(":batch") ? "overview" : "editor",
  ratio: { width: 1, height: 1 },
  ratioValid: true,
  ratioRevision: 0,
  scope: "selected",
  folder: "",
  sourcePage: 0,
  overviewPage: 0,
  phase: "idle",
  error: null,
}));
export function rectangleSignature(source: CropSource, rectangle: CropRect): string {
  return JSON.stringify([source.content_version, rectangle]);
}
export function pendingRegion(draft: SourceDraft, region: RegionDraft): boolean {
  return (
    region.failure !== null ||
    region.generated?.signature !== rectangleSignature(draft.source, region.rectangle)
  );
}
export function pendingCount(draft: SourceDraft): number {
  return draft.regions.filter((region) => pendingRegion(draft, region)).length;
}
export type SourceStatus = "unconfigured" | "pending" | "generated" | "failed";
export function sourceStatus(draft: SourceDraft): SourceStatus {
  if (draft.sourceError || draft.invalid || draft.regions.some((region) => region.failure))
    return "failed";
  if (!draft.regions.length) return "unconfigured";
  return pendingCount(draft) ? "pending" : "generated";
}
export function createSourceDraft(source: CropSource, mode: CropMode, ratio: Ratio): SourceDraft {
  return {
    source,
    selected: mode === "batch" ? 0 : -1,
    invalid: false,
    sourceError: null,
    regions:
      mode === "batch"
        ? [
            {
              id: `batch:${source.id}`,
              rectangle: centeredRect(source.width, source.height, ratio),
              generated: null,
              failure: null,
              touched: false,
            },
          ]
        : [],
  };
}
export function reconcileSources(
  state: WorkbenchState,
  sources: CropSource[],
  mode: CropMode,
  focus: string | null,
  entry: string | null,
): WorkbenchState {
  const ids = sources.map((source) => source.id);
  const token = focus ? `${focus}:${entry ?? ""}` : null;
  const changedFocus = focus !== null && token !== state.focusToken && ids.includes(focus);
  const sameSources =
    JSON.stringify(ids) === JSON.stringify(state.sourceIds) &&
    sources.every(
      (source) => state.drafts[source.id]?.source.content_version === source.content_version,
    );
  if (sameSources && !changedFocus) return state;
  const updates = sources.map((source): [string, SourceDraft] => {
    const existing = state.drafts[source.id];
    if (!existing) return [source.id, createSourceDraft(source, mode, state.ratio)];
    if (existing.source.content_version !== source.content_version)
      return [source.id, { ...existing, sourceError: "源图已变化，请重新载入这张图片后编辑。" }];
    return [source.id, existing];
  });
  return {
    ...state,
    sourceIds: ids,
    drafts: { ...state.drafts, ...Object.fromEntries(updates) },
    activeId: changedFocus
      ? focus
      : state.activeId && ids.includes(state.activeId)
        ? state.activeId
        : (ids[0] ?? null),
    focusToken: changedFocus ? token : state.focusToken,
    view: changedFocus ? "editor" : state.view,
    sourcePage: Math.min(state.sourcePage, Math.max(0, Math.ceil(ids.length / 50) - 1)),
    overviewPage: Math.min(state.overviewPage, Math.max(0, Math.ceil(ids.length / 24) - 1)),
  };
}
export function replaceRectangles(
  draft: SourceDraft,
  rectangles: CropRect[],
  ids: string[],
): SourceDraft {
  return {
    ...draft,
    invalid: false,
    regions: rectangles.map((rectangle, index) => {
      const existing = draft.regions[index];
      if (
        existing &&
        rectangleSignature(draft.source, existing.rectangle) ===
          rectangleSignature(draft.source, rectangle)
      )
        return existing;
      return {
        id: existing?.id ?? ids[index],
        rectangle,
        generated: existing?.generated ?? null,
        failure: null,
        touched: true,
      };
    }),
  };
}
export function markOperationUndone(state: WorkbenchState, operationId: string): WorkbenchState {
  return {
    ...state,
    drafts: Object.fromEntries(
      Object.entries(state.drafts).map(([id, draft]) => [
        id,
        {
          ...draft,
          regions: draft.regions.map((region) =>
            region.generated?.operationId === operationId
              ? { ...region, generated: null, failure: null, touched: true }
              : region,
          ),
        },
      ]),
    ),
  };
}
export function resetBatchRatio(state: WorkbenchState, ratio: Ratio): WorkbenchState {
  return {
    ...state,
    ratio,
    ratioValid: true,
    ratioRevision: state.ratioRevision + 1,
    drafts: Object.fromEntries(
      Object.entries(state.drafts).map(([id, draft]) => [
        id,
        {
          ...draft,
          invalid: false,
          regions: draft.regions.map((region) => ({
            ...region,
            rectangle: centeredRect(draft.source.width, draft.source.height, ratio),
            failure: null,
            touched: true,
          })),
        },
      ]),
    ),
  };
}
export function hasManualPositions(state: WorkbenchState): boolean {
  return Object.values(state.drafts).some((draft) =>
    draft.regions.some((region) => {
      const centered = centeredRect(
        draft.source.width,
        draft.source.height,
        region.rectangle.ratio,
      );
      return centered.x !== region.rectangle.x || centered.y !== region.rectangle.y;
    }),
  );
}

export function hasUnsavedCropDrafts(drafts: Record<string, SourceDraft>): boolean {
  return Object.values(drafts).some(
    (draft) =>
      draft.invalid ||
      draft.regions.some((region) => region.touched && pendingRegion(draft, region)),
  );
}

export function removeFirstRegion(draft: SourceDraft): SourceDraft {
  const regions = draft.regions.slice(1);
  return {
    ...draft,
    regions,
    selected: regions.length ? Math.max(0, draft.selected - 1) : -1,
    invalid: false,
  };
}
