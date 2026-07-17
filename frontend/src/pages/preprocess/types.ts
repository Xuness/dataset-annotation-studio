export interface PreprocessFormState {
  scope: "all" | "selected";
  resizeEnabled: boolean;
  maxEdge: number;
  allowUpscale: boolean;
  convertEnabled: boolean;
  format: "webp" | "jpeg" | "png";
  quality: number;
  effort: number;
  concurrencyMode: "auto" | "manual";
  maxWorkers: number;
  renameEnabled: boolean;
  renameTemplate: string;
  renameStartIndex: number;
  renamePadding: number;
}
