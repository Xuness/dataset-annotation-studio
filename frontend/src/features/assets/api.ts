import { apiAssetUrl, apiRequest } from "../../shared/api/client";
import type {
  AssetAnnotationTrace,
  AssetFolderListResponse,
  AssetIdListResponse,
  AssetListResponse,
  CandidateScope,
  CandidateSetSummary,
  CandidateUpdateRequest,
  MetadataDocument,
  PromptPreview,
} from "../../shared/api/types";

export interface AssetQuery {
  search?: string;
  status?: string | null;
  folderPath?: string;
  folderPaths?: readonly string[];
  candidateScope?: CandidateScope;
  offset?: number;
  limit?: number;
}

function appendFolderPaths(parameters: URLSearchParams, query: AssetQuery): void {
  const folderPaths = [
    ...(query.folderPaths ?? []),
    ...(query.folderPath ? [query.folderPath] : []),
  ];
  for (const folderPath of new Set(folderPaths)) {
    if (folderPath) parameters.append("folder_path", folderPath);
  }
}

export function listAssets(projectId: string, query: AssetQuery): Promise<AssetListResponse> {
  const parameters = new URLSearchParams();
  if (query.search) parameters.set("search", query.search);
  if (query.status) parameters.set("status", query.status);
  if (query.candidateScope) parameters.set("candidate_scope", query.candidateScope);
  appendFolderPaths(parameters, query);
  parameters.set("offset", String(query.offset ?? 0));
  parameters.set("limit", String(query.limit ?? 10_000));
  return apiRequest(`/api/v1/workspaces/${projectId}/assets?${parameters}`);
}

export function listAssetIds(projectId: string, query: AssetQuery): Promise<AssetIdListResponse> {
  const parameters = new URLSearchParams();
  if (query.search) parameters.set("search", query.search);
  if (query.status) parameters.set("status", query.status);
  if (query.candidateScope) parameters.set("candidate_scope", query.candidateScope);
  appendFolderPaths(parameters, query);
  return apiRequest(`/api/v1/workspaces/${projectId}/assets/ids?${parameters}`);
}

export function listAssetFolders(
  projectId: string,
  candidateScope: CandidateScope = "auto",
): Promise<AssetFolderListResponse> {
  const parameters = new URLSearchParams({ candidate_scope: candidateScope });
  return apiRequest(`/api/v1/workspaces/${projectId}/assets/folders?${parameters}`);
}

export function getCandidateSummary(projectId: string): Promise<CandidateSetSummary> {
  return apiRequest(`/api/v1/workspaces/${projectId}/assets/candidates`);
}

export function listCandidateIds(projectId: string): Promise<AssetIdListResponse> {
  return apiRequest(`/api/v1/workspaces/${projectId}/assets/candidates/ids`);
}

export function updateCandidates(
  projectId: string,
  request: CandidateUpdateRequest,
): Promise<CandidateSetSummary> {
  return apiRequest(`/api/v1/workspaces/${projectId}/assets/candidates`, {
    method: "PATCH",
    body: JSON.stringify(request),
  });
}

export function getMetadata(projectId: string, assetId: string): Promise<MetadataDocument> {
  return apiRequest(`/api/v1/workspaces/${projectId}/assets/${assetId}/metadata`);
}

export function getPromptPreview(projectId: string, assetId: string): Promise<PromptPreview> {
  return apiRequest(`/api/v1/workspaces/${projectId}/assets/${assetId}/prompt-preview`);
}

export function getAnnotationTrace(
  projectId: string,
  assetId: string,
): Promise<AssetAnnotationTrace | null> {
  return apiRequest(`/api/v1/workspaces/${projectId}/assets/${assetId}/annotation-trace`);
}

export function getAnnotationTraces(
  projectId: string,
  assetId: string,
  limit = 100,
): Promise<AssetAnnotationTrace[]> {
  const parameters = new URLSearchParams({ limit: String(limit) });
  return apiRequest(
    `/api/v1/workspaces/${projectId}/assets/${assetId}/annotation-traces?${parameters}`,
  );
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
  return apiAssetUrl(`/api/v1/workspaces/${projectId}/assets/${assetId}/thumbnail?${parameters}`);
}
