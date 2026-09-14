import type { ApiOutput, ApiSchema } from "../schema";

export type ExportScope = ApiSchema<"ExportScope">;
export type ExportRevisionMode = ApiSchema<"ExportRevisionMode">;
export type ExportFormat = ApiSchema<"ExportFormat">;
export type ExportPackaging = ApiSchema<"ExportPackaging">;
export type ExportDirectoryMode = ApiSchema<"ExportDirectoryMode">;
export type ExportDirectoryLayout = ApiSchema<"ExportDirectoryLayout">;
export type ExportChannelSelection = ApiSchema<"ExportChannelSelection">;
export type ExportRequest = ApiSchema<"ExportRequest">;
export type ExportPreviewItem = ApiOutput<"ExportPreviewItem">;
export type ExportPreview = ApiOutput<"ExportPreview">;
export type ExportOperationStatus = ApiSchema<"ExportOperationStatus">;
type GeneratedExportOperation = ApiOutput<"ExportOperation">;
export type ExportOperation = Omit<GeneratedExportOperation, "configuration_snapshot"> & {
  configuration_snapshot: {
    content_mode?: "annotations_only" | "images_and_annotations";
    destination_kind?: "source" | "directory";
    primary_txt_channel_key?: string | null;
    conflict_policy?: "block" | "replace_annotations";
    channels?: ExportChannelSelection[];
    formats?: ExportFormat[];
    packaging?: ExportPackaging;
    directory_layout?: ExportDirectoryLayout;
  };
};
