import type {
  ImageProcessingBackends,
  PreprocessExecutionMode,
  PreprocessExecutionOptions,
  PreprocessOperation,
  PreprocessRequest,
  ResizeAlgorithm,
} from "../../shared/api/types";
import { createScopedViewState } from "../../shared/store/scopedViewState.ts";

export interface PreprocessFormState {
  scope: "all" | "selected" | "folder";
  folderPath: string;
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

export function createInitialPreprocessForm(): PreprocessFormState {
  return {
    scope: "all",
    folderPath: "",
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

export interface PreprocessWorkbenchView {
  form: PreprocessFormState;
  selectedOperationId: string | null;
}

export const preprocessWorkbenchState = createScopedViewState<PreprocessWorkbenchView>(() => ({
  form: createInitialPreprocessForm(),
  selectedOperationId: null,
}));

export const ACTIVE_PREPROCESS_STATUSES = new Set<PreprocessOperation["status"]>([
  "running",
  "recovering",
]);

export function buildPreprocessRequest(
  form: PreprocessFormState,
  checkedAssetIds: readonly string[],
  folderAssetIds: readonly string[],
): PreprocessRequest {
  return {
    asset_ids:
      form.scope === "selected"
        ? [...checkedAssetIds]
        : form.scope === "folder"
          ? [...folderAssetIds]
          : [],
    resize: form.resizeEnabled
      ? {
          max_edge: form.maxEdge,
          allow_upscale: form.allowUpscale,
          algorithm: form.resizeAlgorithm,
        }
      : null,
    convert: form.convertEnabled
      ? { format: form.format, quality: form.quality, effort: form.effort }
      : null,
    rename: form.renameEnabled
      ? {
          template: form.renameTemplate,
          start_index: form.renameStartIndex,
          padding: form.renamePadding,
        }
      : null,
  };
}

export function resolvePreprocessAcceleratorId(
  form: PreprocessFormState,
  backends: ImageProcessingBackends | undefined,
): string | null {
  if (form.executionMode !== "prefer_accelerator") return null;
  const usable = backends?.backends.filter(
    (backend) => backend.id !== "cpu" && backend.status !== "unavailable",
  );
  return (
    usable?.find((backend) => backend.id === form.acceleratorId)?.id ?? usable?.[0]?.id ?? null
  );
}

export function buildPreprocessExecution(
  form: PreprocessFormState,
  acceleratorId: string | null,
): PreprocessExecutionOptions {
  return {
    mode: form.executionMode,
    accelerator_id: acceleratorId,
    max_workers: form.concurrencyMode === "manual" ? form.maxWorkers : null,
    batch_size: form.batchMode === "manual" ? form.batchSize : null,
  };
}

export function preprocessRequestFingerprint(
  projectId: string,
  request: PreprocessRequest,
): string {
  return JSON.stringify([projectId, request]);
}

export function reconcileSelectedPreprocessOperationId(
  selectedOperationId: string | null,
  operations: readonly PreprocessOperation[],
): string | null {
  if (selectedOperationId && operations.some((operation) => operation.id === selectedOperationId)) {
    return selectedOperationId;
  }
  return (
    operations.find((operation) => ACTIVE_PREPROCESS_STATUSES.has(operation.status))?.id ?? null
  );
}
