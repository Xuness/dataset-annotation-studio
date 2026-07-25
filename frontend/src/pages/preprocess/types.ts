import type { PreprocessExecutionMode, ResizeAlgorithm } from "../../shared/api/types";

export interface PreprocessFormState {
  scope: "all" | "selected";
  resizeEnabled: boolean;
  maxEdge: number;
  allowUpscale: boolean;
  resizeAlgorithm: ResizeAlgorithm;
  convertEnabled: boolean;
  format: "webp" | "jpeg" | "png";
  quality: number;
  effort: number;
  executionMode: PreprocessExecutionMode;
  acceleratorId: string;
  concurrencyMode: "auto" | "manual";
  maxWorkers: number;
  batchMode: "auto" | "manual";
  batchSize: number;
  renameEnabled: boolean;
  renameTemplate: string;
  renameStartIndex: number;
  renamePadding: number;
}
