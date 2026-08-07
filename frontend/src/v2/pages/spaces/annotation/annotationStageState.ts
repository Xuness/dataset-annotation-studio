import { createScopedViewState } from "../../../../shared/store/scopedViewState.ts";

interface AnnotationStageViewState {
  folderPaths: readonly string[];
}

export const annotationStageViewState = createScopedViewState<AnnotationStageViewState>(() => ({
  folderPaths: [],
}));
