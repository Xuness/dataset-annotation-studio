import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  acceptJobItem,
  createJob,
  getJob,
  listJobs,
  resumeJob,
  retryFailed,
  stopJob,
  type CreateJobInput,
} from "./api";

const isActive = (status: string) => ["queued", "running", "stopping"].includes(status);

export function useJobs(projectId: string) {
  return useQuery({
    queryKey: ["jobs", projectId],
    queryFn: () => listJobs(projectId),
    refetchInterval: (query) =>
      query.state.data?.some((job) => isActive(job.status)) ? 1000 : 5000,
  });
}

export function useJob(projectId: string, jobId: string | null) {
  return useQuery({
    queryKey: ["jobs", projectId, jobId],
    queryFn: () => getJob(projectId, jobId!),
    enabled: Boolean(jobId),
    refetchInterval: (query) =>
      query.state.data && isActive(query.state.data.status) ? 1000 : false,
  });
}

export function useJobActions(projectId: string) {
  const queryClient = useQueryClient();
  const invalidate = (jobId?: string) => {
    void queryClient.invalidateQueries({ queryKey: ["jobs", projectId] });
    if (jobId) void queryClient.invalidateQueries({ queryKey: ["jobs", projectId, jobId] });
    void queryClient.invalidateQueries({ queryKey: ["assets", projectId] });
    void queryClient.invalidateQueries({ queryKey: ["workspaces", projectId] });
  };
  return {
    create: useMutation({
      mutationFn: (input: CreateJobInput) => createJob(projectId, input),
      onSuccess: (job) => invalidate(job.id),
    }),
    stop: useMutation({
      mutationFn: (jobId: string) => stopJob(projectId, jobId),
      onSuccess: (job) => invalidate(job.id),
    }),
    resume: useMutation({
      mutationFn: (jobId: string) => resumeJob(projectId, jobId),
      onSuccess: (job) => invalidate(job.id),
    }),
    retry: useMutation({
      mutationFn: (jobId: string) => retryFailed(projectId, jobId),
      onSuccess: (job) => invalidate(job.id),
    }),
    accept: useMutation({
      mutationFn: ({ jobId, itemId }: { jobId: string; itemId: string }) =>
        acceptJobItem(projectId, jobId, itemId),
      onSuccess: (job) => invalidate(job.id),
    }),
  };
}
