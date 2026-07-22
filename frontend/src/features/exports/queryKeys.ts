export const exportKeys = {
  all: ["exports"] as const,
  project: (projectId: string) => ["exports", projectId] as const,
};
