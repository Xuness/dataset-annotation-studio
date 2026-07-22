export const workspaceKeys = {
  all: ["workspaces"] as const,
  detail: (projectId: string) => ["workspaces", projectId] as const,
};
