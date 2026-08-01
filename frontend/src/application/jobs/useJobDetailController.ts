import { useCallback, useEffect, useState } from "react";

import { useJob, useJobActions } from "../../features/jobs/hooks";
import { actionError } from "../interaction";

export function useJobDetailController(projectId: string, jobId: string | null) {
  const [itemLimit, setItemLimit] = useState(200);
  const job = useJob(projectId, jobId, itemLimit);
  const actions = useJobActions(projectId);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setItemLimit(200);
    setError(null);
  }, [jobId]);

  const runAction = useCallback(async (action: () => Promise<unknown>) => {
    setError(null);
    try {
      await action();
    } catch (reason) {
      setError(actionError(reason, "任务操作失败。"));
    }
  }, []);

  const stop = useCallback(
    (targetJobId: string) => runAction(() => actions.stop.mutateAsync(targetJobId)),
    [actions.stop, runAction],
  );
  const resume = useCallback(
    (targetJobId: string) => runAction(() => actions.resume.mutateAsync(targetJobId)),
    [actions.resume, runAction],
  );
  const retry = useCallback(
    (targetJobId: string) => runAction(() => actions.retry.mutateAsync(targetJobId)),
    [actions.retry, runAction],
  );
  const accept = useCallback(
    (targetJobId: string, itemId: string) =>
      runAction(() => actions.accept.mutateAsync({ jobId: targetJobId, itemId })),
    [actions.accept, runAction],
  );
  const loadMore = useCallback(
    (exceptionCount: number) => setItemLimit((current) => Math.min(current + 200, exceptionCount)),
    [],
  );

  const active = Boolean(job.data && ["queued", "running", "stopping"].includes(job.data.status));
  const stopping = job.data?.status === "stopping";
  const resumable = Boolean(job.data && ["stopped", "interrupted"].includes(job.data.status));
  const exceptionItems =
    job.data?.items.filter(
      (item) => item.status === "failed" || item.result_disposition === "candidate",
    ) ?? [];
  const exceptionCount = (job.data?.failed ?? 0) + (job.data?.candidate_results ?? 0);

  return {
    job,
    error,
    active,
    stopping,
    resumable,
    exceptionItems,
    exceptionCount,
    stopPending: actions.stop.isPending,
    resumePending: actions.resume.isPending,
    retryPending: actions.retry.isPending,
    acceptPending: actions.accept.isPending,
    stop,
    resume,
    retry,
    accept,
    loadMore,
  };
}
