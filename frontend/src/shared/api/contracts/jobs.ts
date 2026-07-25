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

export type JobKind = "annotation" | "translation";
export type ExecutionBackend = "provider" | "local_tagger";
export type ExistingTranslationPolicy = "skip" | "stale" | "overwrite";

export interface JobSummary {
  id: string;
  status: JobStatus;
  kind: JobKind;
  execution_backend: ExecutionBackend;
  execution_profile_id: string;
  execution_profile_name: string;
  system_preset_id: string | null;
  system_preset_name: string | null;
  provider_profile_id: string | null;
  provider_profile_name: string | null;
  model: string;
  scope: "all" | "selected";
  overwrite_existing: boolean;
  output_channel: "tags" | "description" | "translation";
  use_tags_as_context: boolean;
  target_language: string | null;
  translation_policy: ExistingTranslationPolicy | null;
  retry_limit: number;
  total: number;
  pending: number;
  running: number;
  succeeded: number;
  failed: number;
  skipped: number;
  manually_accepted: number;
  candidate_results: number;
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
  cache_read_tokens: number | null;
  cache_write_tokens: number | null;
  reasoning_tokens: number | null;
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
  result_disposition: "none" | "applied" | "candidate";
  attempts: JobAttempt[];
}

export interface JobDetail extends JobSummary {
  items: JobItemDetail[];
}
