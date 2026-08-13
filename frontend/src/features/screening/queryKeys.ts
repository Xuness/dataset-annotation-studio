import { workspaceQueryKeys } from "../../shared/query/workspaceQueries";
import type { ScreeningItemQuery } from "../../shared/api/types";

export const screeningKeys = {
  capabilities: (projectId: string) =>
    [...workspaceQueryKeys.scope(projectId, "screening"), "capabilities"] as const,
  operations: (projectId: string) =>
    [...workspaceQueryKeys.scope(projectId, "screening"), "operations"] as const,
  items: (projectId: string, operationId: string, query: ScreeningItemQuery) =>
    [
      ...workspaceQueryKeys.scope(projectId, "screening"),
      "operations",
      operationId,
      "items",
      query,
    ] as const,
};
