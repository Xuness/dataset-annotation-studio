import { apiRequest } from "../../shared/api/client";
import type { ExportOperation, ExportPreview, ExportRequest } from "../../shared/api/types";

const exportPath = (projectId: string) => `/api/v1/workspaces/${projectId}/exports`;

export function previewExport(projectId: string, request: ExportRequest): Promise<ExportPreview> {
  return apiRequest(`${exportPath(projectId)}/preview`, {
    method: "POST",
    body: JSON.stringify(request),
  });
}

export function createExport(
  projectId: string,
  request: ExportRequest,
  previewToken: string,
  allowWarnings: boolean,
): Promise<ExportOperation> {
  return apiRequest(exportPath(projectId), {
    method: "POST",
    body: JSON.stringify({
      request,
      preview_token: previewToken,
      allow_warnings: allowWarnings,
    }),
  });
}

export function listExports(projectId: string): Promise<ExportOperation[]> {
  return apiRequest(exportPath(projectId));
}

export function stopExport(projectId: string, operationId: string): Promise<ExportOperation> {
  return apiRequest(`${exportPath(projectId)}/${operationId}/stop`, {
    method: "POST",
  });
}

export function resumeExport(projectId: string, operationId: string): Promise<ExportOperation> {
  return apiRequest(`${exportPath(projectId)}/${operationId}/resume`, {
    method: "POST",
  });
}
