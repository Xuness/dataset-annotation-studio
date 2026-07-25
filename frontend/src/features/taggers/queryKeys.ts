export const taggerKeys = {
  all: ["taggers"] as const,
  library: ["taggers", "library"] as const,
  downloads: ["taggers", "downloads"] as const,
  downloadTasks: ["taggers", "downloads", "tasks"] as const,
  huggingFace: ["taggers", "huggingface"] as const,
  vocabulary: (installationId: string, fingerprint: string, query: string, category: string) =>
    ["taggers", "vocabulary", installationId, fingerprint, query, category] as const,
};
