export const jobKeys = {
  all: ["jobs"] as const,
  project: (projectId: string) => ["jobs", projectId] as const,
  history: (projectId: string, pageSize: number) =>
    ["jobs", projectId, "history", pageSize] as const,
  detail: (projectId: string, jobId: string | null, itemLimit: number) =>
    ["jobs", projectId, jobId, itemLimit] as const,
  detailPrefix: (projectId: string, jobId: string) => ["jobs", projectId, jobId] as const,
};
