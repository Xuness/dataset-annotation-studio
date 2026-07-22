import { apiRequest } from "../../shared/api/client";
import type {
  ExistingTranslationPolicy,
  ExecutionBackend,
  JobDetail,
  JobKind,
  JobSummary,
} from "../../shared/api/types";

export interface CreateJobInput {
  execution_backend: ExecutionBackend;
  provider_profile_id?: string;
  model_id?: string;
  tagger_profile_id?: string;
  kind: JobKind;
  scope: "all" | "selected";
  asset_ids: string[];
  overwrite_existing?: boolean;
  translation_prompt_preset_id?: string;
  target_language?: string;
  translation_policy?: ExistingTranslationPolicy;
}

const jobsPath = (projectId: string) => `/api/v1/workspaces/${projectId}/jobs`;

export function listJobs(
  projectId: string,
  {
    offset = 0,
    limit = 100,
    activeOnly = false,
  }: { offset?: number; limit?: number; activeOnly?: boolean } = {},
): Promise<JobSummary[]> {
  const query = new URLSearchParams({
    offset: String(offset),
    limit: String(limit),
    active_only: String(activeOnly),
  });
  return apiRequest(`${jobsPath(projectId)}?${query}`);
}

export function getJob(projectId: string, jobId: string, itemLimit = 200): Promise<JobDetail> {
  const query = new URLSearchParams({ items: "failed", item_limit: String(itemLimit) });
  return apiRequest(`${jobsPath(projectId)}/${jobId}?${query}`);
}

export function createJob(projectId: string, input: CreateJobInput): Promise<JobDetail> {
  return apiRequest(jobsPath(projectId), { method: "POST", body: JSON.stringify(input) });
}

export function stopJob(projectId: string, jobId: string): Promise<JobDetail> {
  return apiRequest(`${jobsPath(projectId)}/${jobId}/stop`, { method: "POST" });
}

export function stopAllJobs(projectId: string): Promise<{ stopped: number }> {
  return apiRequest(`${jobsPath(projectId)}/stop-all`, { method: "POST" });
}

export function getActiveJobs(): Promise<{
  count: number;
  project_count: number;
  annotation_job_count: number;
  translation_job_count: number;
  preprocessing_count: number;
  export_count: number;
}> {
  return apiRequest("/api/v1/jobs/active");
}

export function stopAllWorkspaceJobs(): Promise<{ stopped: number }> {
  return apiRequest("/api/v1/jobs/stop-all", { method: "POST" });
}

export function resumeJob(projectId: string, jobId: string): Promise<JobDetail> {
  return apiRequest(`${jobsPath(projectId)}/${jobId}/resume`, { method: "POST" });
}

export function retryFailed(projectId: string, jobId: string): Promise<JobDetail> {
  return apiRequest(`${jobsPath(projectId)}/${jobId}/retry-failed`, { method: "POST" });
}

export function acceptJobItem(
  projectId: string,
  jobId: string,
  itemId: string,
): Promise<JobDetail> {
  return apiRequest(`${jobsPath(projectId)}/${jobId}/items/${itemId}/accept`, {
    method: "POST",
  });
}
