import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  getWorkspace,
  listWorkspaces,
  openWorkspace,
  rescanWorkspace,
  updateWorkspace,
} from "./api";

export const workspaceKeys = {
  all: ["workspaces"] as const,
  detail: (projectId: string) => ["workspaces", projectId] as const,
};

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

export function useRescanWorkspace(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => rescanWorkspace(projectId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: workspaceKeys.detail(projectId) });
      void queryClient.invalidateQueries({ queryKey: ["assets", projectId] });
    },
  });
}

export function useUpdateWorkspace(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (update: Parameters<typeof updateWorkspace>[1]) =>
      updateWorkspace(projectId, update),
    onSuccess: (workspace) => {
      queryClient.setQueryData(workspaceKeys.detail(projectId), workspace);
      void queryClient.invalidateQueries({ queryKey: ["assets", projectId] });
    },
  });
}
