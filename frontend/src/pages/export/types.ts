import type { ExportChannelSelection, ExportFormat, ExportScope } from "../../shared/api/types";

export interface ExportFormState {
  scope: ExportScope;
  destinationPath: string;
  selections: ExportChannelSelection[];
  formats: ExportFormat[];
}
