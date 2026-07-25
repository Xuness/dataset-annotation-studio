import { apiRequest } from "../../shared/api/client";
import type {
  TagDictionaryDownloadCenter,
  TagDictionaryDownloadTask,
  TagDictionaryInstallation,
  TagDictionaryLibrary,
  TagDictionaryOverride,
  TagDictionaryResolution,
  TagDictionarySearchResult,
} from "../../shared/api/types";

export function getTagDictionaryLibrary(): Promise<TagDictionaryLibrary> {
  return apiRequest("/api/v1/tag-dictionaries");
}

export function importTagDictionary(path: string, name?: string): Promise<TagDictionaryLibrary> {
  return apiRequest("/api/v1/tag-dictionaries", {
    method: "POST",
    body: JSON.stringify({ path, name }),
  });
}

export function updateTagDictionaryInstallation(
  id: string,
  input: { enabled?: boolean; name?: string },
): Promise<TagDictionaryInstallation> {
  return apiRequest(`/api/v1/tag-dictionaries/installations/${id}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export function reorderTagDictionaries(installationIds: string[]): Promise<TagDictionaryLibrary> {
  return apiRequest("/api/v1/tag-dictionaries/order", {
    method: "PUT",
    body: JSON.stringify({ installation_ids: installationIds }),
  });
}

export function deleteTagDictionaryInstallation(id: string): Promise<TagDictionaryLibrary> {
  return apiRequest(`/api/v1/tag-dictionaries/installations/${id}`, {
    method: "DELETE",
  });
}

export function searchTagDictionaryEntries(
  query: string,
  language = "zh-CN",
  signal?: AbortSignal,
): Promise<TagDictionarySearchResult> {
  const parameters = new URLSearchParams({
    q: query,
    language,
    limit: "80",
  });
  return apiRequest(`/api/v1/tag-dictionaries/entries/search?${parameters}`, { signal });
}

export function resolveTagDictionaryEntries(
  tags: Array<{ name: string; category: string | null }>,
  language = "zh-CN",
  signal?: AbortSignal,
): Promise<TagDictionaryResolution> {
  return apiRequest("/api/v1/tag-dictionaries/resolve", {
    method: "POST",
    body: JSON.stringify({
      tags: tags.map((tag) => tag.name),
      categories: tags.map((tag) => tag.category),
      language,
    }),
    signal,
  });
}

export function upsertTagDictionaryOverride(input: {
  tag: string;
  translation: string;
  language: string;
  category?: string | null;
}): Promise<TagDictionaryOverride> {
  return apiRequest("/api/v1/tag-dictionaries/overrides", {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

export function deleteTagDictionaryOverride(tag: string, language: string): Promise<void> {
  const parameters = new URLSearchParams({ tag, language });
  return apiRequest(`/api/v1/tag-dictionaries/overrides?${parameters}`, {
    method: "DELETE",
  });
}

export function getTagDictionaryDownloadCenter(): Promise<TagDictionaryDownloadCenter> {
  return apiRequest("/api/v1/tag-dictionaries/downloads");
}

export function getTagDictionaryDownloadTasks(): Promise<TagDictionaryDownloadTask[]> {
  return apiRequest("/api/v1/tag-dictionaries/downloads/tasks");
}

export function createTagDictionaryDownload(offerId: string): Promise<TagDictionaryDownloadTask> {
  return apiRequest("/api/v1/tag-dictionaries/downloads", {
    method: "POST",
    body: JSON.stringify({ offer_id: offerId, license_accepted: true }),
  });
}

export function pauseTagDictionaryDownload(id: string): Promise<TagDictionaryDownloadTask> {
  return apiRequest(`/api/v1/tag-dictionaries/downloads/${id}/pause`, {
    method: "POST",
  });
}

export function resumeTagDictionaryDownload(id: string): Promise<TagDictionaryDownloadTask> {
  return apiRequest(`/api/v1/tag-dictionaries/downloads/${id}/resume`, {
    method: "POST",
  });
}

export function deleteTagDictionaryDownload(id: string): Promise<TagDictionaryDownloadCenter> {
  return apiRequest(`/api/v1/tag-dictionaries/downloads/${id}`, {
    method: "DELETE",
  });
}
