import type { ExportScope } from "../../shared/api/types";

export interface ExportFormState {
  scope: ExportScope;
  destinationPath: string;
}
