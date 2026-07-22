export const preprocessingKeys = {
  all: ["preprocessing"] as const,
  project: (projectId: string) => ["preprocessing", projectId] as const,
  operations: (projectId: string) => ["preprocessing", projectId, "operations"] as const,
};
