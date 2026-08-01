import { workspaceQueryKeys } from "../../shared/query/workspaceQueries";

export const statisticsKeys = {
  project: (projectId: string) => workspaceQueryKeys.scope(projectId, "statistics"),
  tagFrequency: (projectId: string) =>
    [...workspaceQueryKeys.scope(projectId, "statistics"), "tag-frequency"] as const,
};
