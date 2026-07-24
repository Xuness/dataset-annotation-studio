import { apiRequest } from "../../shared/api/client";
import type {
  HuggingFaceConnectionSettings,
  HuggingFaceConnectionTest,
  HuggingFaceSettingsUpdate,
  TaggerDownloadCenter,
  TaggerDownloadTask,
  TaggerInstallation,
  TaggerLibrary,
  TaggerProfile,
  TaggerProfileInput,
} from "../../shared/api/types";

export function getTaggerLibrary(): Promise<TaggerLibrary> {
  return apiRequest("/api/v1/taggers");
}

export function updateTaggerModelRoot(modelRoot: string): Promise<TaggerLibrary> {
  return apiRequest("/api/v1/taggers/settings", {
    method: "PATCH",
    body: JSON.stringify({ model_root: modelRoot }),
  });
}

export function importLocalTagger(path: string, name?: string): Promise<TaggerLibrary> {
  return apiRequest("/api/v1/taggers/import", {
    method: "POST",
    body: JSON.stringify({ path, name }),
  });
}

export function rescanTaggers(): Promise<TaggerLibrary> {
  return apiRequest("/api/v1/taggers/rescan", { method: "POST" });
}

export function validateTaggerInstallation(id: string): Promise<TaggerInstallation> {
  return apiRequest(`/api/v1/taggers/installations/${id}/validate`, { method: "POST" });
}

export function deleteTaggerInstallation(id: string): Promise<TaggerLibrary> {
  return apiRequest(`/api/v1/taggers/installations/${id}`, { method: "DELETE" });
}

export function createTaggerProfile(input: TaggerProfileInput): Promise<TaggerProfile> {
  return apiRequest("/api/v1/taggers/profiles", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateTaggerProfile(
  id: string,
  input: Partial<TaggerProfileInput>,
): Promise<TaggerProfile> {
  return apiRequest(`/api/v1/taggers/profiles/${id}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export function deleteTaggerProfile(id: string): Promise<TaggerLibrary> {
  return apiRequest(`/api/v1/taggers/profiles/${id}`, { method: "DELETE" });
}

export function getTaggerDownloadCenter(): Promise<TaggerDownloadCenter> {
  return apiRequest("/api/v1/taggers/downloads");
}

export function getTaggerDownloadTasks(): Promise<TaggerDownloadTask[]> {
  return apiRequest("/api/v1/taggers/downloads/tasks");
}

export function createTaggerDownload(input: {
  planId: string;
  licenseAccepted: boolean;
}): Promise<TaggerDownloadTask> {
  return apiRequest("/api/v1/taggers/downloads", {
    method: "POST",
    body: JSON.stringify({
      plan_id: input.planId,
      license_accepted: input.licenseAccepted,
    }),
  });
}

export function pauseTaggerDownload(id: string): Promise<TaggerDownloadTask> {
  return apiRequest(`/api/v1/taggers/downloads/${id}/pause`, { method: "POST" });
}

export function resumeTaggerDownload(id: string): Promise<TaggerDownloadTask> {
  return apiRequest(`/api/v1/taggers/downloads/${id}/resume`, { method: "POST" });
}

export function deleteTaggerDownload(id: string): Promise<TaggerDownloadCenter> {
  return apiRequest(`/api/v1/taggers/downloads/${id}`, { method: "DELETE" });
}

export function getHuggingFaceSettings(): Promise<HuggingFaceConnectionSettings> {
  return apiRequest("/api/v1/taggers/huggingface");
}

export function updateHuggingFaceSettings(
  input: HuggingFaceSettingsUpdate,
): Promise<HuggingFaceConnectionSettings> {
  return apiRequest("/api/v1/taggers/huggingface", {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export function testHuggingFaceConnection(): Promise<HuggingFaceConnectionTest> {
  return apiRequest("/api/v1/taggers/huggingface/test", { method: "POST" });
}
