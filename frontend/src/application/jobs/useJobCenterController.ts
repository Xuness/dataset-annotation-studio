import { useCallback, useEffect, useMemo } from "react";

import { useJobHistory, useJobs } from "../../features/jobs/hooks";
import { useWorkspace } from "../../features/workspaces/hooks";
import { useWorkspaceSelectionStore } from "../../shared/store/workspaceSelectionStore";
import { jobCenterViewState, reconcileSelectedJobId } from "./jobCenterState";

export function useJobCenterController(projectId: string) {
  const workspace = useWorkspace(projectId);
  const jobs = useJobHistory(projectId);
  const activeJobs = useJobs(projectId);
  const checkedAssetIds = useWorkspaceSelectionStore((state) => state.checkedAssetIds);
  const setActiveProject = useWorkspaceSelectionStore((state) => state.setActiveProject);
  const { selectedJobId } = jobCenterViewState.useValue(projectId);
  const jobItems = useMemo(() => jobs.data?.pages.flat() ?? [], [jobs.data?.pages]);

  const setSelectedJobId = useCallback(
    (jobId: string | null) => jobCenterViewState.patch(projectId, { selectedJobId: jobId }),
    [projectId],
  );

  useEffect(() => setActiveProject(projectId), [projectId, setActiveProject]);
  useEffect(() => {
    if (!jobs.data) return;
    const loadedJobIds = jobItems.map((job) => job.id);
    jobCenterViewState.patch(projectId, (current) => {
      const nextSelectedJobId = reconcileSelectedJobId(
        current.selectedJobId,
        loadedJobIds,
        Boolean(jobs.hasNextPage),
      );
      return nextSelectedJobId === current.selectedJobId
        ? {}
        : { selectedJobId: nextSelectedJobId };
    });
  }, [jobItems, jobs.data, jobs.hasNextPage, projectId]);

  const loadMore = useCallback(() => {
    if (jobs.hasNextPage && !jobs.isFetchingNextPage) void jobs.fetchNextPage();
  }, [jobs]);

  return {
    workspace,
    jobs,
    activeJobs,
    checkedAssetIds,
    selectedJobId,
    setSelectedJobId,
    jobItems,
    loadMore,
  };
}
