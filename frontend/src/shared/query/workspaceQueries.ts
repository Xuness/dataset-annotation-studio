import type { QueryClient, QueryKey } from "@tanstack/react-query";

export const WORKSPACE_QUERY_SCOPES = [
  "workspace",
  "assets",
  "metadata",
  "prompt-preview",
  "annotation-trace",
  "annotations",
  "annotation-history",
  "translations",
  "statistics",
  "jobs",
  "preprocessing",
  "screening",
  "exports",
  "asset-deletions",
] as const;

export type WorkspaceQueryScope = (typeof WORKSPACE_QUERY_SCOPES)[number];

const WORKSPACE_QUERY_ROOT = "workspace-data";

export const workspaceQueryKeys = {
  all: [WORKSPACE_QUERY_ROOT] as const,
  project: (projectId: string) => [WORKSPACE_QUERY_ROOT, projectId] as const,
  scope: (projectId: string, scope: WorkspaceQueryScope) =>
    [WORKSPACE_QUERY_ROOT, projectId, scope] as const,
};

export type WorkspaceMutationKind =
  | "annotation-written"
  | "asset-deletion-changed"
  | "export-changed"
  | "job-output-changed"
  | "preprocessing-changed"
  | "translation-refreshed"
  | "workspace-rescanned"
  | "workspace-settings-updated";

const MUTATION_SCOPES: Record<WorkspaceMutationKind, readonly WorkspaceQueryScope[]> = {
  "annotation-written": [
    "annotations",
    "annotation-history",
    "annotation-trace",
    "prompt-preview",
    "translations",
    "assets",
    "workspace",
    "statistics",
  ],
  "asset-deletion-changed": [
    "asset-deletions",
    "assets",
    "annotations",
    "translations",
    "workspace",
    "statistics",
  ],
  "export-changed": ["exports"],
  "job-output-changed": [
    "jobs",
    "annotations",
    "annotation-history",
    "assets",
    "annotation-trace",
    "translations",
    "workspace",
    "statistics",
  ],
  "preprocessing-changed": ["preprocessing", "assets", "workspace"],
  "translation-refreshed": [
    "translations",
    "annotations",
    "annotation-history",
    "assets",
    "workspace",
    "statistics",
  ],
  "workspace-rescanned": ["workspace", "assets", "metadata", "prompt-preview"],
  "workspace-settings-updated": ["assets", "prompt-preview"],
};

export async function invalidateWorkspaceMutation(
  queryClient: QueryClient,
  projectId: string,
  kind: WorkspaceMutationKind,
): Promise<void> {
  await Promise.all(
    MUTATION_SCOPES[kind].map((scope) =>
      queryClient.invalidateQueries({ queryKey: workspaceQueryKeys.scope(projectId, scope) }),
    ),
  );
}

export async function invalidateWorkspaceScopeAcrossProjects(
  queryClient: QueryClient,
  scope: WorkspaceQueryScope,
): Promise<void> {
  await queryClient.invalidateQueries({
    predicate: (query) => isWorkspaceScopeQuery(query.queryKey, scope),
  });
}

export function isWorkspaceScopeQuery(queryKey: QueryKey, scope: WorkspaceQueryScope): boolean {
  return queryKey[0] === WORKSPACE_QUERY_ROOT && queryKey[2] === scope;
}
