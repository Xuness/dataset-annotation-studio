import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { ExportRequest } from "../../shared/api/types";
import { createExport, listExports, previewExport, resumeExport, stopExport } from "./api";

const activeStatuses = new Set(["queued", "running", "stopping"]);

export function useExportOperations(projectId: string) {
  return useQuery({
    queryKey: ["exports", projectId],
    queryFn: () => listExports(projectId),
    enabled: Boolean(projectId),
    refetchInterval: (query) =>
      query.state.data?.some((operation) => activeStatuses.has(operation.status)) ? 1000 : false,
  });
}

export function useExportActions(projectId: string) {
  const queryClient = useQueryClient();
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["exports", projectId] });
  };
  return {
    preview: useMutation({
      mutationFn: (request: ExportRequest) => previewExport(projectId, request),
    }),
    create: useMutation({
      mutationFn: ({
        request,
        previewToken,
        allowWarnings,
      }: {
        request: ExportRequest;
        previewToken: string;
        allowWarnings: boolean;
      }) => createExport(projectId, request, previewToken, allowWarnings),
      onSuccess: refresh,
    }),
    stop: useMutation({
      mutationFn: (operationId: string) => stopExport(projectId, operationId),
      onSuccess: refresh,
    }),
    resume: useMutation({
      mutationFn: (operationId: string) => resumeExport(projectId, operationId),
      onSuccess: refresh,
    }),
  };
}
