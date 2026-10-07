import type { CropSourceRegions } from "../../shared/api/types";
import { pendingRegion, rectangleSignature, type WorkbenchState } from "./workbenchState";

export interface SubmittedRegion {
  sourceId: string;
  regionId: string;
  signature: string;
}
export interface CropSubmission {
  items: CropSourceRegions[];
  marks: SubmittedRegion[];
}
export function pendingSubmission(state: WorkbenchState, ids: string[]): CropSubmission {
  const groups = ids.map((id) => {
    const draft = state.drafts[id];
    return {
      id,
      regionIds: draft.regions
        .filter((region) => pendingRegion(draft, region))
        .map((region) => region.id),
    };
  });
  return submissionForRegions(state, groups);
}
export function repeatSubmission(state: WorkbenchState, id: string): CropSubmission {
  return submissionForRegions(state, [
    { id, regionIds: state.drafts[id].regions.map((region) => region.id) },
  ]);
}
function submissionForRegions(
  state: WorkbenchState,
  groups: { id: string; regionIds: string[] }[],
): CropSubmission {
  const items: CropSourceRegions[] = [];
  const marks: SubmittedRegion[] = [];
  for (const { id, regionIds } of groups) {
    const draft = state.drafts[id];
    const regions = draft.regions.filter((region) => regionIds.includes(region.id));
    if (!regions.length) continue;
    if (draft.invalid || draft.sourceError)
      throw new Error(
        `${draft.source.filename}：${draft.sourceError ?? "存在无效参数，请先修正。"}`,
      );
    items.push({
      asset_id: id,
      source_version: draft.source.content_version,
      rectangles: regions.map((region) => region.rectangle),
    });
    marks.push(
      ...regions.map((region) => ({
        sourceId: id,
        regionId: region.id,
        signature: rectangleSignature(draft.source, region.rectangle),
      })),
    );
  }
  if (!marks.length) throw new Error("没有待生成的裁剪区域，请先框选或调整图片。");
  return { items, marks };
}
export function submissionIsCurrent(state: WorkbenchState, submission: CropSubmission): boolean {
  return submission.marks.every((mark) => {
    const draft = state.drafts[mark.sourceId];
    const region = draft?.regions.find((item) => item.id === mark.regionId);
    return (
      state.sourceIds.includes(mark.sourceId) &&
      draft &&
      !draft.invalid &&
      !draft.sourceError &&
      region &&
      rectangleSignature(draft.source, region.rectangle) === mark.signature
    );
  });
}
export function recordSubmission(
  state: WorkbenchState,
  submission: CropSubmission,
  operationId: string | null,
  failure: string | null,
): WorkbenchState {
  const drafts = { ...state.drafts };
  for (const mark of submission.marks) {
    const draft = drafts[mark.sourceId];
    if (!draft) continue;
    drafts[mark.sourceId] = {
      ...draft,
      regions: draft.regions.map((region) => {
        if (
          region.id !== mark.regionId ||
          rectangleSignature(draft.source, region.rectangle) !== mark.signature
        )
          return region;
        return operationId
          ? {
              ...region,
              generated: { signature: mark.signature, operationId },
              failure: null,
              touched: false,
            }
          : { ...region, failure };
      }),
    };
  }
  return { ...state, drafts };
}
