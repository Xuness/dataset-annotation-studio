export const assetDeletionKeys = {
  all: ["asset-deletions"] as const,
  project: (projectId: string) => ["asset-deletions", projectId] as const,
};
