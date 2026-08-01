import type { ApiOutput, ApiSchema } from "../schema";

export type ExportScope = ApiSchema<"ExportScope">;
export type ExportRevisionMode = ApiSchema<"ExportRevisionMode">;
export type ExportFormat = ApiSchema<"ExportFormat">;
export type ExportPackaging = ApiSchema<"ExportPackaging">;
export type ExportChannelSelection = ApiSchema<"ExportChannelSelection">;
export type ExportRequest = ApiSchema<"ExportRequest">;
export type ExportPreviewItem = ApiOutput<"ExportPreviewItem">;
export type ExportPreview = ApiOutput<"ExportPreview">;
export type ExportOperationStatus = ApiSchema<"ExportOperationStatus">;
type GeneratedExportOperation = ApiOutput<"ExportOperation">;
export type ExportOperation = Omit<GeneratedExportOperation, "configuration_snapshot"> & {
  configuration_snapshot: {
    channels?: ExportChannelSelection[];
    formats?: ExportFormat[];
    packaging?: ExportPackaging;
  };
};
