import { apiRequest } from "../../shared/api/client";
import type { AssetDeleteOperation, AssetDeletionPreview } from "../../shared/api/types";

const deletionPath = (projectId: string) => `/api/v1/workspaces/${projectId}/asset-deletions`;

export function previewAssetDeletion(
  projectId: string,
  assetIds: string[],
): Promise<AssetDeletionPreview> {
  return apiRequest(`${deletionPath(projectId)}/preview`, {
    method: "POST",
    body: JSON.stringify({ asset_ids: assetIds }),
  });
}

export function executeAssetDeletion(
  projectId: string,
  assetIds: string[],
  previewToken: string,
): Promise<AssetDeleteOperation> {
  return apiRequest(`${deletionPath(projectId)}/execute`, {
    method: "POST",
    body: JSON.stringify({
      request: { asset_ids: assetIds },
      preview_token: previewToken,
    }),
  });
}

export function listAssetDeletions(projectId: string): Promise<AssetDeleteOperation[]> {
  return apiRequest(`${deletionPath(projectId)}/operations`);
}

export function undoAssetDeletion(
  projectId: string,
  operationId: string,
): Promise<AssetDeleteOperation> {
  return apiRequest(`${deletionPath(projectId)}/operations/${operationId}/undo`, {
    method: "POST",
  });
}
