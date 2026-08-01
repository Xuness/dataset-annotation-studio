import { workspaceQueryKeys } from "../../shared/query/workspaceQueries";

export const workspaceKeys = {
  all: ["workspaces"] as const,
  detail: (projectId: string) => workspaceQueryKeys.scope(projectId, "workspace"),
};
