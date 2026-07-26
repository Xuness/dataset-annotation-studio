import { createScopedViewState } from "../../shared/store/scopedViewState";
import type { PreprocessFormState } from "./types";

function createInitialPreprocessForm(): PreprocessFormState {
  return {
    scope: "all",
    resizeEnabled: true,
    maxEdge: 2048,
    allowUpscale: false,
    resizeAlgorithm: "lanczos3",
    convertEnabled: false,
    format: "webp",
    quality: 90,
    effort: 4,
    executionMode: "auto",
    acceleratorId: "",
    concurrencyMode: "auto",
    maxWorkers: 8,
    batchMode: "auto",
    batchSize: 32,
    renameEnabled: false,
    renameTemplate: "image_{index}",
    renameStartIndex: 1,
    renamePadding: 6,
  };
}

export interface PreprocessView {
  form: PreprocessFormState;
  selectedOperationId: string | null;
}

export const preprocessViewState = createScopedViewState<PreprocessView>(() => ({
  form: createInitialPreprocessForm(),
  selectedOperationId: null,
}));
