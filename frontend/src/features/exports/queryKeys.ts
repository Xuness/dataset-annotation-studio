import { workspaceQueryKeys } from "../../shared/query/workspaceQueries";

export const exportKeys = {
  project: (projectId: string) => workspaceQueryKeys.scope(projectId, "exports"),
};
