export const statisticsKeys = {
  all: ["statistics"] as const,
  project: (projectId: string) => ["statistics", projectId] as const,
  tagFrequency: (projectId: string) => ["statistics", projectId, "tag-frequency"] as const,
};
