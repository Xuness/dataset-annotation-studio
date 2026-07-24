import type {
  AnnotationChannel,
  ExportFormat,
  ExportRevisionMode,
  ExportScope,
} from "../../shared/api/types";

export interface ExportFormState {
  scope: ExportScope;
  destinationPath: string;
  channels: AnnotationChannel[];
  translationLanguage: string;
  revision: ExportRevisionMode;
  formats: ExportFormat[];
}
