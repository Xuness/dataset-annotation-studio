import { apiRequest } from "../../shared/api/client";
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
