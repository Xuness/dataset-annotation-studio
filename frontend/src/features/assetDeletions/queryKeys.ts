import { workspaceQueryKeys } from "../../shared/query/workspaceQueries";

export const assetDeletionKeys = {
  project: (projectId: string) => workspaceQueryKeys.scope(projectId, "asset-deletions"),
};
