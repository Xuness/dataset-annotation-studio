import { apiRequest } from "../../shared/api/client";
import type {
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
