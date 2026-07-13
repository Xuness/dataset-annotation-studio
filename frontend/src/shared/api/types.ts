export type AnnotationStatus =
  "missing" | "valid" | "invalid" | "empty" | "unchecked" | "manually_accepted";

export interface WorkspaceSettings {
  recursive_scan: boolean;
  user_prompt: string;
  json_fields: string[];
  validation_mode: string;
}

export interface WorkspaceSummary {
  project_id: string;
  name: string;
  root_path: string;
  exists: boolean;
  created_at: string;
  last_opened_at: string | null;
  settings: WorkspaceSettings;
  asset_count: number;
  annotated_count: number;
  invalid_count: number;
}

export interface ScanResult {
  scanned_files: number;
  indexed_assets: number;
  added: number;
  updated: number;
  missing: number;
  failed: number;
  issues: Array<{ path: string; message: string }>;
  duration_ms: number;
}

export interface WorkspaceOpenResponse {
  workspace: WorkspaceSummary;
  scan: ScanResult;
}

export interface AssetSummary {
  id: string;
  relative_path: string;
  filename: string;
  suffix: string;
  content_version: string;
  byte_size: number;
  width: number;
  height: number;
  annotation_relative_path: string;
  annotation_status: AnnotationStatus;
  metadata_relative_path: string | null;
}

export interface AssetListResponse {
  items: AssetSummary[];
  total: number;
  offset: number;
  limit: number;
  status_counts: Record<string, number>;
}

export interface AssetIdListResponse {
  ids: string[];
  total: number;
}

export interface ValidationIssue {
  code: string;
  message: string;
  offset: number | null;
  tag: string | null;
}

export interface ValidationResult {
  valid: boolean;
  status: AnnotationStatus;
  tag_count: number;
  issues: ValidationIssue[];
}

export interface AnnotationDocument {
  asset_id: string;
  path: string;
  exists: boolean;
  content: string;
  status: AnnotationStatus;
  validation: ValidationResult | null;
  modified_at: string | null;
}

export interface AnnotationRevision {
  id: string;
  source: string;
  validation_status: AnnotationStatus;
  created_at: string;
  content: string;
}

export interface MetadataDocument {
  exists: boolean;
  path: string | null;
  value: unknown;
  fields: string[];
  error: string | null;
}

export interface PromptPreview {
  user_prompt: string;
  metadata_lines: string[];
  final_prompt: string;
}

export interface FrequencyBucket {
  value: string;
  count: number;
  share: number;
}

export interface AnnotationStatistics {
  analyzer: string;
  document_count: number;
  occurrence_count: number;
  buckets: FrequencyBucket[];
}

export interface SystemPreset {
  id: string;
  name: string;
  system_prompt: string;
  created_at: string;
  updated_at: string;
}

export type ProviderType = "openrouter" | "openai_compatible" | "gemini";
export type ServiceTier = "flex" | "priority";
export type ReasoningEffort = "max" | "xhigh" | "high" | "medium" | "low" | "minimal" | "none";

export interface ProviderRequestOptions {
  top_p: number | null;
  seed: number | null;
  service_tier: ServiceTier | null;
  reasoning_effort: ReasoningEffort | null;
}

export interface ProviderProfile {
  id: string;
  name: string;
  provider_type: ProviderType;
  base_url: string;
  model: string;
  temperature: number;
  max_output_tokens: number;
  concurrency: number;
  timeout_seconds: number;
  request_options: ProviderRequestOptions;
  has_api_key: boolean;
  created_at: string;
  updated_at: string;
}

export interface ProviderModelSummary {
  id: string;
  name: string;
  description: string;
  context_length: number | null;
  max_output_tokens: number | null;
  input_modalities: string[];
  supported_parameters: string[];
  reasoning_efforts: string[];
  prompt_price: string | null;
  completion_price: string | null;
}

export type JobStatus =
  | "queued"
  | "running"
  | "stopping"
  | "stopped"
  | "interrupted"
  | "completed"
  | "completed_with_errors";

export type JobItemStatus =
  "pending" | "running" | "succeeded" | "failed" | "interrupted" | "skipped" | "manually_accepted";

export interface JobSummary {
  id: string;
  status: JobStatus;
  system_preset_id: string;
  system_preset_name: string;
  provider_profile_id: string;
  provider_profile_name: string;
  scope: "all" | "selected";
  overwrite_existing: boolean;
  retry_limit: number;
  total: number;
  pending: number;
  running: number;
  succeeded: number;
  failed: number;
  skipped: number;
  manually_accepted: number;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export interface JobAttempt {
  id: string;
  attempt_number: number;
  status: string;
  response_content: string | null;
  error_message: string | null;
  started_at: string;
  finished_at: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  finish_reason: string | null;
}

export interface JobItemDetail {
  id: string;
  asset_id: string;
  relative_path: string;
  status: JobItemStatus;
  attempt_count: number;
  last_error: string | null;
  validation_status: string | null;
  manually_accepted: boolean;
  attempts: JobAttempt[];
}

export interface JobDetail extends JobSummary {
  items: JobItemDetail[];
}

export interface ResizeOptions {
  max_edge: number;
  allow_upscale: boolean;
}

export interface ConvertOptions {
  format: "webp" | "jpeg" | "png";
  quality: number;
  effort: number;
}

export interface PreprocessRequest {
  asset_ids: string[];
  resize: ResizeOptions | null;
  convert: ConvertOptions | null;
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
