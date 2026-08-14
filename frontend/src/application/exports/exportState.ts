import type {
  ExportChannelSelection,
  ExportDirectoryLayout,
  ExportFormat,
  ExportOperation,
  ExportPackaging,
  ExportRequest,
  ExportScope,
} from "../../shared/api/types";
import { createScopedViewState } from "../../shared/store/scopedViewState.ts";

export interface ExportFormState {
  scope: ExportScope;
  destinationPath: string;
  selections: ExportChannelSelection[];
  formats: ExportFormat[];
  packaging: ExportPackaging;
  directoryLayout: ExportDirectoryLayout;
}

export function createInitialExportForm(): ExportFormState {
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
    packaging: "directory",
    directoryLayout: {
      mode: "flat",
      merge_into_parent_paths: [],
    },
  };
}

export interface ExportWorkbenchView {
  form: ExportFormState;
}

export const exportWorkbenchState = createScopedViewState<ExportWorkbenchView>(() => ({
  form: createInitialExportForm(),
}));

const ACTIVE_EXPORT_STATUSES = new Set<ExportOperation["status"]>([
  "queued",
  "running",
  "stopping",
]);

export function buildExportRequest(
  form: ExportFormState,
  checkedAssetIds: readonly string[],
): ExportRequest {
  return {
    scope: form.scope,
    asset_ids: form.scope === "selected" ? [...checkedAssetIds] : [],
    destination_path: form.destinationPath,
    channels: form.selections,
    formats: form.formats,
    packaging: form.packaging,
    directory_layout: {
      mode: form.directoryLayout.mode,
      merge_into_parent_paths:
        form.directoryLayout.mode === "custom"
          ? [...(form.directoryLayout.merge_into_parent_paths ?? [])]
          : [],
    },
  };
}

export function exportRequestFingerprint(projectId: string, request: ExportRequest): string {
  return JSON.stringify([projectId, request]);
}

export function hasActiveExport(operations: readonly ExportOperation[] | undefined): boolean {
  return Boolean(operations?.some((operation) => ACTIVE_EXPORT_STATUSES.has(operation.status)));
}
