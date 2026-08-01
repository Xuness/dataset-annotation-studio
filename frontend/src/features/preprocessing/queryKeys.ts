import { workspaceQueryKeys } from "../../shared/query/workspaceQueries";

export const preprocessingKeys = {
  project: (projectId: string) => workspaceQueryKeys.scope(projectId, "preprocessing"),
  operations: (projectId: string) =>
    [...workspaceQueryKeys.scope(projectId, "preprocessing"), "operations"] as const,
  executionPlan: (projectId: string, previewToken: string, execution: object) =>
    [
      ...workspaceQueryKeys.scope(projectId, "preprocessing"),
      "execution-plan",
      previewToken,
      execution,
    ] as const,
  backends: ["system", "image-processing", "backends"] as const,
};
