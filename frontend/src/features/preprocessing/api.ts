import { apiRequest } from "../../shared/api/client";
import type {
  PreprocessOperation,
  PreprocessPreview,
  PreprocessRequest,
} from "../../shared/api/types";

const path = (projectId: string) => `/api/v1/workspaces/${projectId}/preprocessing`;

export function previewPreprocessing(
  projectId: string,
  request: PreprocessRequest,
): Promise<PreprocessPreview> {
  return apiRequest(`${path(projectId)}/preview`, {
    method: "POST",
    body: JSON.stringify(request),
  });
}

export function executePreprocessing(
  projectId: string,
  request: PreprocessRequest,
  previewToken: string,
): Promise<PreprocessOperation> {
  return apiRequest(`${path(projectId)}/execute`, {
    method: "POST",
    body: JSON.stringify({ request, preview_token: previewToken }),
  });
}

export function listPreprocessOperations(projectId: string): Promise<PreprocessOperation[]> {
  return apiRequest(`${path(projectId)}/operations`);
}

export function undoPreprocessOperation(
  projectId: string,
  operationId: string,
): Promise<PreprocessOperation> {
  return apiRequest(`${path(projectId)}/operations/${operationId}/undo`, { method: "POST" });
}
