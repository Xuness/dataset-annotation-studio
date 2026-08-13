import { apiRequest } from "../../shared/api/client";
import type {
  CreateScreeningOperationRequest,
  ScreeningAssetIdListResponse,
  ScreeningCapabilities,
  ScreeningItemListResponse,
  ScreeningItemQuery,
  ScreeningOperation,
} from "../../shared/api/types";

const path = (projectId: string) => `/api/v1/workspaces/${projectId}/screening`;

function itemParameters(query: ScreeningItemQuery): URLSearchParams {
  const parameters = new URLSearchParams();
  if (query.offset !== undefined) parameters.set("offset", String(query.offset));
  if (query.limit !== undefined) parameters.set("limit", String(query.limit));
  if (query.pool) parameters.set("pool", query.pool);
  if (query.rating) parameters.set("rating", query.rating);
  if (query.flag === "low_resolution") parameters.set("low_resolution", "true");
  if (query.flag === "duplicate_variant") parameters.set("duplicate_variant", "true");
  if (query.sort) parameters.set("sort", query.sort);
  return parameters;
}

export function getScreeningCapabilities(projectId: string): Promise<ScreeningCapabilities> {
  return apiRequest(`${path(projectId)}/capabilities`);
}

export function createScreeningOperation(
  projectId: string,
  request: CreateScreeningOperationRequest,
): Promise<ScreeningOperation> {
  return apiRequest(`${path(projectId)}/operations`, {
    method: "POST",
    body: JSON.stringify(request),
  });
}

export function listScreeningOperations(projectId: string): Promise<ScreeningOperation[]> {
  return apiRequest(`${path(projectId)}/operations`);
}

export function stopScreeningOperation(
  projectId: string,
  operationId: string,
): Promise<ScreeningOperation> {
  return apiRequest(`${path(projectId)}/operations/${operationId}/stop`, { method: "POST" });
}

export function resumeScreeningOperation(
  projectId: string,
  operationId: string,
): Promise<ScreeningOperation> {
  return apiRequest(`${path(projectId)}/operations/${operationId}/resume`, { method: "POST" });
}

export function listScreeningItems(
  projectId: string,
  operationId: string,
  query: ScreeningItemQuery,
): Promise<ScreeningItemListResponse> {
  return apiRequest(`${path(projectId)}/operations/${operationId}/items?${itemParameters(query)}`);
}

export function listScreeningAssetIds(
  projectId: string,
  operationId: string,
  query: ScreeningItemQuery,
): Promise<ScreeningAssetIdListResponse> {
  return apiRequest(
    `${path(projectId)}/operations/${operationId}/asset-ids?${itemParameters(query)}`,
  );
}
