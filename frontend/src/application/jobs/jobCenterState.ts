import { createScopedViewState } from "../../shared/store/scopedViewState";

export interface JobCenterView {
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
}));
