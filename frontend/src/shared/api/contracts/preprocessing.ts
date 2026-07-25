export type ResizeAlgorithm = "lanczos3" | "lanczos4" | "anime_low_halo";
export type PreprocessExecutionMode = "auto" | "cpu_only" | "prefer_accelerator";
export type PreprocessRoute = "cpu" | "accelerated_full" | "accelerated_resize";

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

export interface PreprocessPreview {
  items: PreprocessPreviewItem[];
  total_items: number;
  truncated: boolean;
  changed_count: number;
  unchanged_count: number;
  warning_count: number;
  preview_token: string;
}

export interface PreprocessExecutionOptions {
  mode: PreprocessExecutionMode;
  accelerator_id: string | null;
  max_workers: number | null;
  batch_size: number | null;
}

export interface ImageProcessingBackend {
  id: string;
  kind: string;
  label: string;
  status: "ready" | "degraded" | "unavailable";
  device_name: string | null;
  total_memory_bytes: number | null;
  supports_batch: boolean;
  decode_formats: string[];
  encode_formats: string[];
  resize_algorithms: ResizeAlgorithm[];
  issue: string | null;
}

export interface ImageProcessingBackends {
  revision: string;
  backends: ImageProcessingBackend[];
}

export interface PreprocessExecutionPlanItem {
  asset_id: string;
  route: PreprocessRoute;
  backend_id: string;
  reason_code: string | null;
}

export interface PreprocessExecutionPlan {
  items: PreprocessExecutionPlanItem[];
  total_render_items: number;
  truncated: boolean;
  selected_backend_id: string;
  route_counts: Record<string, number>;
  route_reasons: Record<string, number>;
  effective_cpu_workers: number;
  effective_batch_size: number;
  capability_revision: string;
}

export interface PreprocessExecutionRuntime {
  requested_mode: PreprocessExecutionMode;
  selected_backend_id: string;
  backend_label: string;
  route_counts: Record<string, number>;
  route_reason_counts: Record<string, number>;
  fallback_counts: Record<string, number>;
  worker_count: number;
  batch_size: number;
  duration_ms: number;
}

export interface PreprocessOperation {
  id: string;
  status: string;
  item_count: number;
  options: PreprocessRequest;
  execution: PreprocessExecutionOptions;
  created_at: string;
  completed_at: string | null;
  undone_at: string | null;
  error_message: string | null;
  runtime: PreprocessExecutionRuntime | null;
}
