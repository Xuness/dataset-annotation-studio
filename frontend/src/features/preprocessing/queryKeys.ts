export const preprocessingKeys = {
  all: ["preprocessing"] as const,
  project: (projectId: string) => ["preprocessing", projectId] as const,
  operations: (projectId: string) => ["preprocessing", projectId, "operations"] as const,
  executionPlan: (projectId: string, previewToken: string, execution: object) =>
    ["preprocessing", projectId, "execution-plan", previewToken, execution] as const,
  backends: ["system", "image-processing", "backends"] as const,
};
