export type ResizeAlgorithm = "lanczos3" | "lanczos4" | "anime_low_halo";

export interface ResizeOptions {
  max_edge: number;
  allow_upscale: boolean;
  algorithm: ResizeAlgorithm;
}

export interface ConvertOptions {
  format: "webp" | "jpeg" | "png";
  quality: number;
  effort: number;
}

export interface RenameOptions {
  template: string;
  start_index: number;
  padding: number;
}

export interface PreprocessRequest {
  asset_ids: string[];
  resize: ResizeOptions | null;
  convert: ConvertOptions | null;
  rename: RenameOptions | null;
}

export interface PreprocessPreviewItem {
  asset_id: string;
  before_relative_path: string;
  after_relative_path: string;
  before_width: number;
  before_height: number;
  after_width: number;
  after_height: number;
  will_change: boolean;
  warning: string | null;
}

export interface PreprocessRuntimeInfo {
  device: "cpu";
  preview_duration_ms: number;
  source_bytes: number;
  render_count: number;
  automatic_worker_count: number;
  maximum_worker_count: number;
}

export interface PreprocessPreview {
  items: PreprocessPreviewItem[];
  total_items: number;
  truncated: boolean;
  changed_count: number;
  unchanged_count: number;
  warning_count: number;
  preview_token: string;
  runtime: PreprocessRuntimeInfo;
}

export interface PreprocessExecutionOptions {
  max_workers: number | null;
}

export interface PreprocessOperation {
  id: string;
  status: string;
  item_count: number;
  options: PreprocessRequest;
  created_at: string;
  completed_at: string | null;
  undone_at: string | null;
  error_message: string | null;
}
