import { createScopedViewState } from "../../shared/store/scopedViewState";
import type { ExportFormState } from "./types";

function createInitialExportForm(): ExportFormState {
  return {
    scope: "all",
    destinationPath: "",
    selections: [
      {
        channel: "existing_annotation",
        language: "",
        revision: "current",
      },
    ],
    formats: ["txt"],
  };
}

export interface ExportView {
  form: ExportFormState;
}

export const exportViewState = createScopedViewState<ExportView>(() => ({
  form: createInitialExportForm(),
}));
