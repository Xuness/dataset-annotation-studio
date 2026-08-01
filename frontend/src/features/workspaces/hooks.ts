import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { invalidateWorkspaceMutation } from "../../shared/query/workspaceQueries";
import type { ScanResult } from "../../shared/api/types";
import {
  getWorkspace,
  listWorkspaces,
  openWorkspace,
  removeRecentWorkspace,
  rescanWorkspace,
  updateWorkspace,
} from "./api";
import { workspaceKeys } from "./queryKeys";

export function useRecentWorkspaces() {
  return useQuery({ queryKey: workspaceKeys.all, queryFn: listWorkspaces });
}

export function useWorkspace(projectId: string) {
  return useQuery({
    queryKey: workspaceKeys.detail(projectId),
    queryFn: () => getWorkspace(projectId),
    enabled: Boolean(projectId),
  });
}

export function useOpenWorkspace() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: openWorkspace,
    onSuccess: ({ workspace }) => {
      queryClient.setQueryData(workspaceKeys.detail(workspace.project_id), workspace);
      void queryClient.invalidateQueries({ queryKey: workspaceKeys.all });
    },
  });
}

export function useRemoveRecentWorkspace() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: removeRecentWorkspace,
    onSuccess: (_result, projectId) => {
      queryClient.setQueryData<Awaited<ReturnType<typeof listWorkspaces>>>(
        workspaceKeys.all,
        (workspaces) => workspaces?.filter((workspace) => workspace.project_id !== projectId),
      );
      queryClient.removeQueries({
        queryKey: workspaceKeys.detail(projectId),
        exact: true,
      });
    },
  });
}

interface RescanWorkspaceCallbacks {
  onSuccess?: (result: ScanResult) => void;
  onError?: (error: Error) => void;
}

export function useRescanWorkspace(projectId: string, callbacks: RescanWorkspaceCallbacks = {}) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => rescanWorkspace(projectId),
    onSuccess: (result) => {
      void invalidateWorkspaceMutation(queryClient, projectId, "workspace-rescanned");
      callbacks.onSuccess?.(result);
    },
    onError: (error) =>
      callbacks.onError?.(error instanceof Error ? error : new Error("重新扫描失败。")),
  });
}

export function useUpdateWorkspace(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (update: Parameters<typeof updateWorkspace>[1]) =>
      updateWorkspace(projectId, update),
    onSuccess: (workspace) => {
      queryClient.setQueryData(workspaceKeys.detail(projectId), workspace);
      void invalidateWorkspaceMutation(queryClient, projectId, "workspace-settings-updated");
    },
  });
}
