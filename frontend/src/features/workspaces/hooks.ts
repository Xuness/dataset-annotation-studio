import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { assetKeys, metadataKeys, promptPreviewKeys } from "../assets/queryKeys";
import { alertDialog } from "../../shared/ui/dialogs";
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

export function useRescanWorkspace(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => rescanWorkspace(projectId),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: workspaceKeys.detail(projectId) });
      void queryClient.invalidateQueries({ queryKey: assetKeys.project(projectId) });
      void queryClient.invalidateQueries({ queryKey: metadataKeys.project(projectId) });
      void queryClient.invalidateQueries({ queryKey: promptPreviewKeys.project(projectId) });
      if (result.failed) {
        const examples = result.issues
          .slice(0, 5)
          .map((issue) => `${issue.path}：${issue.message}`)
          .join("\n");
        void alertDialog(`扫描跳过了 ${result.failed} 个无法读取的图片。\n${examples}`, {
          title: "扫描完成，但有跳过",
        });
      }
    },
    onError: (error) =>
      void alertDialog(error instanceof Error ? error.message : "重新扫描失败。", {
        title: "重新扫描失败",
      }),
  });
}

export function useUpdateWorkspace(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (update: Parameters<typeof updateWorkspace>[1]) =>
      updateWorkspace(projectId, update),
    onSuccess: (workspace) => {
      queryClient.setQueryData(workspaceKeys.detail(projectId), workspace);
      void queryClient.invalidateQueries({ queryKey: assetKeys.project(projectId) });
      void queryClient.invalidateQueries({ queryKey: promptPreviewKeys.project(projectId) });
    },
  });
}
