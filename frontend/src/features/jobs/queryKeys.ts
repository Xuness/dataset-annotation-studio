import { workspaceQueryKeys } from "../../shared/query/workspaceQueries";

export const jobKeys = {
  project: (projectId: string) => workspaceQueryKeys.scope(projectId, "jobs"),
  history: (projectId: string, pageSize: number) =>
    [...workspaceQueryKeys.scope(projectId, "jobs"), "history", pageSize] as const,
  detail: (projectId: string, jobId: string | null, itemLimit: number) =>
    [...workspaceQueryKeys.scope(projectId, "jobs"), "detail", jobId, itemLimit] as const,
  detailPrefix: (projectId: string, jobId: string) =>
    [...workspaceQueryKeys.scope(projectId, "jobs"), "detail", jobId] as const,
  asset: (projectId: string, assetId: string | null) =>
    [...workspaceQueryKeys.scope(projectId, "jobs"), "asset", assetId] as const,
};
