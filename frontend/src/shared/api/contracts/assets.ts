import type { AnnotationStatus } from "./annotations";

export type AssetFilterStatus = AnnotationStatus | "failed" | "needs_review";

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
  generation_status: "failed" | null;
  generation_error: string | null;
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

export interface AssetFolderSummary {
  path: string;
  parent_path: string | null;
  name: string;
  direct_asset_count: number;
  descendant_asset_count: number;
}

export interface AssetFolderListResponse {
  items: AssetFolderSummary[];
}

export interface MetadataDocument {
  exists: boolean;
  path: string | null;
  value: unknown;
  fields: string[];
  error: string | null;
}

export interface PromptPreview {
  system_preset_id: string | null;
  system_preset_name: string | null;
  system_prompt: string;
  user_prompt: string;
  metadata_lines: string[];
  final_user_prompt: string;
  configuration_issue: string | null;
}

export interface AnnotationTraceRequestParameters {
  execution_backend: "provider" | "local_tagger";
  provider_type: string;
  provider_profile_name: string;
  model: string;
  temperature: number | null;
  max_output_tokens: number | null;
  timeout_seconds: number | null;
  top_p: number | null;
  seed: number | null;
  service_tier: string | null;
  reasoning_effort: string | null;
  prompt_cache_strategy: string | null;
  adapter_id: string | null;
  installation_id: string | null;
  model_version: string | null;
  threshold: number | null;
  categories: string[] | null;
  device: string | null;
  batch_size: number | null;
}

export interface AnnotationTraceRequest {
  system_prompt: string;
  user_prompt: string;
  source: "recorded" | "reconstructed";
  parameters: AnnotationTraceRequestParameters;
}

export interface AnnotationTraceResponse {
  reasoning_content: string | null;
  final_content: string | null;
  error_message: string | null;
  finish_reason: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  cache_read_tokens: number | null;
  cache_write_tokens: number | null;
  reasoning_tokens: number | null;
}

export interface AssetAnnotationTrace {
  job_id: string;
  job_status: string;
  item_id: string;
  item_status: string;
  attempt_id: string;
  attempt_number: number;
  attempt_status: string;
  started_at: string;
  finished_at: string | null;
  annotation_exists: boolean;
  annotation_source: string | null;
  matches_current_annotation: boolean;
  request: AnnotationTraceRequest;
  response: AnnotationTraceResponse;
}
