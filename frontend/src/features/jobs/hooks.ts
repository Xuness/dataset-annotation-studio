import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";

import { annotationHistoryKeys, annotationKeys } from "../annotations/queryKeys";
import { annotationTraceKeys, assetKeys } from "../assets/queryKeys";
import { statisticsKeys } from "../statistics/queryKeys";
import { translationKeys } from "../translations/queryKeys";
import { workspaceKeys } from "../workspaces/queryKeys";
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
import { jobKeys } from "./queryKeys";

const isActive = (status: string) => ["queued", "running", "stopping"].includes(status);

export function useJobs(projectId: string) {
  const queryClient = useQueryClient();
  const previousActiveIds = useRef<Set<string> | null>(null);
  const query = useQuery({
    queryKey: jobKeys.project(projectId),
    queryFn: () => listJobs(projectId, { limit: 500, activeOnly: true }),
    enabled: Boolean(projectId),
    refetchInterval: (query) =>
      query.state.data?.some((job) => isActive(job.status)) ? 1000 : 5000,
  });
  const activeSignature =
    query.data
      ?.map((job) => job.id)
      .sort()
      .join("|") ?? "";
  useEffect(() => {
    previousActiveIds.current = null;
  }, [projectId]);
  useEffect(() => {
    if (!query.data) return;
    const activeIds = new Set(query.data.map((job) => job.id));
    const completed =
      previousActiveIds.current !== null &&
      [...previousActiveIds.current].some((jobId) => !activeIds.has(jobId));
    previousActiveIds.current = activeIds;
    if (!completed) return;
    void queryClient.invalidateQueries({ queryKey: annotationKeys.project(projectId) });
    void queryClient.invalidateQueries({
      queryKey: annotationHistoryKeys.project(projectId),
    });
    void queryClient.invalidateQueries({ queryKey: assetKeys.project(projectId) });
    void queryClient.invalidateQueries({ queryKey: annotationTraceKeys.project(projectId) });
    void queryClient.invalidateQueries({ queryKey: translationKeys.project(projectId) });
    void queryClient.invalidateQueries({ queryKey: workspaceKeys.detail(projectId) });
    void queryClient.invalidateQueries({ queryKey: statisticsKeys.project(projectId) });
  }, [activeSignature, projectId, query.data, queryClient]);
  return query;
}

export function useJobHistory(projectId: string, pageSize = 100) {
  return useInfiniteQuery({
    queryKey: jobKeys.history(projectId, pageSize),
    queryFn: ({ pageParam }) => listJobs(projectId, { offset: pageParam, limit: pageSize }),
    initialPageParam: 0,
    getNextPageParam: (lastPage, pages) =>
      lastPage.length < pageSize ? undefined : pages.length * pageSize,
    enabled: Boolean(projectId),
    refetchInterval: (query) =>
      query.state.data?.pages.some((page) => page.some((job) => isActive(job.status)))
        ? 1000
        : false,
  });
}

export function useJob(projectId: string, jobId: string | null, itemLimit = 200) {
  return useQuery({
    queryKey: jobKeys.detail(projectId, jobId, itemLimit),
    queryFn: () => getJob(projectId, jobId!, itemLimit),
    enabled: Boolean(jobId),
    refetchInterval: (query) =>
      query.state.data && isActive(query.state.data.status) ? 1000 : false,
  });
}

export function useJobActions(projectId: string) {
  const queryClient = useQueryClient();
  const invalidate = (jobId?: string) => {
    void queryClient.invalidateQueries({ queryKey: jobKeys.project(projectId) });
    if (jobId) {
      void queryClient.invalidateQueries({ queryKey: jobKeys.detailPrefix(projectId, jobId) });
    }
    void queryClient.invalidateQueries({ queryKey: assetKeys.project(projectId) });
    void queryClient.invalidateQueries({ queryKey: annotationKeys.project(projectId) });
    void queryClient.invalidateQueries({
      queryKey: annotationHistoryKeys.project(projectId),
    });
    void queryClient.invalidateQueries({ queryKey: annotationTraceKeys.project(projectId) });
    void queryClient.invalidateQueries({ queryKey: translationKeys.project(projectId) });
    void queryClient.invalidateQueries({ queryKey: workspaceKeys.detail(projectId) });
    void queryClient.invalidateQueries({ queryKey: statisticsKeys.project(projectId) });
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
