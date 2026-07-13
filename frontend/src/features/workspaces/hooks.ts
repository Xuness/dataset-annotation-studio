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
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: workspaceKeys.detail(projectId) });
      void queryClient.invalidateQueries({ queryKey: ["assets", projectId] });
      void queryClient.invalidateQueries({ queryKey: ["metadata", projectId] });
      void queryClient.invalidateQueries({ queryKey: ["prompt-preview", projectId] });
      if (result.failed) {
        const examples = result.issues
          .slice(0, 5)
          .map((issue) => `${issue.path}：${issue.message}`)
          .join("\n");
        window.alert(`扫描跳过了 ${result.failed} 个无法读取的图片。\n${examples}`);
      }
    },
    onError: (error) => window.alert(error instanceof Error ? error.message : "重新扫描失败。"),
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
      void queryClient.invalidateQueries({ queryKey: ["prompt-preview", projectId] });
    },
  });
}
