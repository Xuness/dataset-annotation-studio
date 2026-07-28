import type {
  ExportChannelSelection,
  ExportFormat,
  ExportPackaging,
  ExportScope,
} from "../../shared/api/types";

export interface ExportFormState {
  scope: ExportScope;
  destinationPath: string;
  selections: ExportChannelSelection[];
  formats: ExportFormat[];
  packaging: ExportPackaging;
}
