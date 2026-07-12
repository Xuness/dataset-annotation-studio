import { apiAssetUrl, apiRequest } from "../../shared/api/client";
import type { AssetListResponse, MetadataDocument, PromptPreview } from "../../shared/api/types";

export interface AssetQuery {
  search?: string;
  status?: string | null;
  offset?: number;
  limit?: number;
}

export function listAssets(projectId: string, query: AssetQuery): Promise<AssetListResponse> {
  const parameters = new URLSearchParams();
  if (query.search) parameters.set("search", query.search);
  if (query.status) parameters.set("status", query.status);
  parameters.set("offset", String(query.offset ?? 0));
  parameters.set("limit", String(query.limit ?? 10_000));
  return apiRequest(`/api/v1/workspaces/${projectId}/assets?${parameters}`);
}

export function getMetadata(projectId: string, assetId: string): Promise<MetadataDocument> {
  return apiRequest(`/api/v1/workspaces/${projectId}/assets/${assetId}/metadata`);
}

export function getPromptPreview(projectId: string, assetId: string): Promise<PromptPreview> {
  return apiRequest(`/api/v1/workspaces/${projectId}/assets/${assetId}/prompt-preview`);
}

export function imageUrl(projectId: string, assetId: string, contentVersion: string): string {
  const version = encodeURIComponent(contentVersion);
  return apiAssetUrl(`/api/v1/workspaces/${projectId}/assets/${assetId}/image?v=${version}`);
}

export function thumbnailUrl(
  projectId: string,
  assetId: string,
  contentVersion: string,
  size = 320,
): string {
  const parameters = new URLSearchParams({ size: String(size), v: contentVersion });
  return apiAssetUrl(
    `/api/v1/workspaces/${projectId}/assets/${assetId}/thumbnail?${parameters}`,
  );
}
