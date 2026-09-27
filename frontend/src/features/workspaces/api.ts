import { apiRequest } from "../../shared/api/client";
import type { ApiSchema, ApiOutput } from "../../shared/api/schema";
import type {
  ScanResult,
  WorkspaceOpenResponse,
  WorkspaceSettings,
  WorkspaceSummary,
} from "../../shared/api/types";

export function listWorkspaces(): Promise<WorkspaceSummary[]> {
  return apiRequest("/api/v1/workspaces");
}

export function openWorkspace(path: string): Promise<WorkspaceOpenResponse> {
  return apiRequest("/api/v1/workspaces/open", {
    method: "POST",
    body: JSON.stringify({ path }),
  });
}

export function getWorkspace(projectId: string): Promise<WorkspaceSummary> {
  return apiRequest(`/api/v1/workspaces/${projectId}`);
}

export function removeRecentWorkspace(projectId: string): Promise<void> {
  return apiRequest(`/api/v1/workspaces/${projectId}/recent`, {
    method: "DELETE",
  });
}

export function rescanWorkspace(projectId: string): Promise<ScanResult> {
  return apiRequest(`/api/v1/workspaces/${projectId}/scan`, { method: "POST" });
}

export function updateWorkspace(
  projectId: string,
  update: Partial<WorkspaceSettings>,
): Promise<WorkspaceSummary> {
  return apiRequest(`/api/v1/workspaces/${projectId}`, {
    method: "PATCH",
    body: JSON.stringify(update),
  });
}

export function listOriginalFiles(projectId: string): Promise<ApiOutput<"OriginalFile">[]> {
  return apiRequest(`/api/v1/workspaces/${projectId}/originals`);
}

export function previewRestore(
  projectId: string,
  request: ApiSchema<"RestoreRequest">,
): Promise<ApiOutput<"RestorePreview">> {
  return apiRequest(`/api/v1/workspaces/${projectId}/restore/preview`, {
    method: "POST",
    body: JSON.stringify(request),
  });
}

export function executeRestore(
  projectId: string,
  execution: ApiSchema<"RestoreExecution">,
): Promise<string> {
  return apiRequest(`/api/v1/workspaces/${projectId}/restore`, {
    method: "POST",
    body: JSON.stringify(execution),
  });
}

export function previewRelocate(
  projectId: string,
  path: string,
): Promise<ApiOutput<"RelocatePreview">> {
  return apiRequest(`/api/v1/workspaces/${projectId}/relocate/preview`, {
    method: "POST",
    body: JSON.stringify({ path }),
  });
}

export function executeRelocate(
  projectId: string,
  execution: ApiSchema<"RelocateExecution">,
): Promise<void> {
  return apiRequest(`/api/v1/workspaces/${projectId}/relocate`, {
    method: "POST",
    body: JSON.stringify(execution),
  });
}

export function detachWorkspace(projectId: string): Promise<void> {
  return apiRequest(`/api/v1/workspaces/${projectId}/detach`, { method: "POST" });
}

export function importIndependentWorkspace(path: string): Promise<WorkspaceOpenResponse> {
  return apiRequest("/api/v1/workspaces/open", {
    method: "POST",
    body: JSON.stringify({ path, independent_copy: true }),
  });
}
