import { createScopedViewState } from "../../shared/store/scopedViewState";

export type JobCenterKind = "annotation" | "translation" | "character";

export interface JobCenterView {
  kind: JobCenterKind;
  selectedCharacterId: string | null;
  selectedJobId: string | null;
}

export function reconcileSelectedJobId(
  selectedJobId: string | null,
  loadedJobIds: readonly string[],
  hasMoreHistory: boolean,
): string | null {
  if (selectedJobId && (loadedJobIds.includes(selectedJobId) || hasMoreHistory)) {
    return selectedJobId;
  }
  return loadedJobIds[0] ?? null;
}

export const jobCenterViewState = createScopedViewState<JobCenterView>(() => ({
  selectedJobId: null,
  kind: "annotation",
  selectedCharacterId: null,
}));
