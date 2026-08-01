import { AlertCircle } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";

import { useJobCenterController } from "../../../src/application/jobs/useJobCenterController";
import { useLegacyRescanWorkspace } from "../../legacy/hooks/useLegacyRescanWorkspace";
import { WorkspaceFrame } from "../../layouts/workspace/WorkspaceFrame";
import { Spinner } from "../../shared/ui/Spinner";
import { Button } from "../../shared/ui/Button";
import { JobDetailPanel } from "./components/JobDetailPanel";
import { JobList } from "./components/JobList";
import { NewJobPanel } from "./components/NewJobPanel";
import "./jobs.css";
import "./job-detail.css";

export function JobsPage() {
  const { projectId = "" } = useParams();
  const navigate = useNavigate();
  const controller = useJobCenterController(projectId);
  const rescan = useLegacyRescanWorkspace(projectId);
  const {
    workspace,
    jobs,
    activeJobs,
    checkedAssetIds,
    selectedJobId,
    setSelectedJobId,
    jobItems,
    loadMore,
  } = controller;

  if (workspace.isError)
    return (
      <div className="workspace-loading workspace-loading--error">
        <AlertCircle size={28} />
        <p>{workspace.error instanceof Error ? workspace.error.message : "工作区不可用。"}</p>
        <Button onClick={() => navigate("/")}>返回项目首页</Button>
      </div>
    );
  if (!workspace.data)
    return (
      <div className="workspace-loading">
        <Spinner />
        <p>正在打开任务中心…</p>
      </div>
    );

  return (
    <WorkspaceFrame
      workspace={workspace.data}
      projectId={projectId}
      active="jobs"
      rescanning={rescan.isPending}
      onRescan={() => rescan.mutate()}
      bodyClassName="jobs-workspace-body"
      statusbar={
        <>
          <span>{activeJobs.data?.length ?? 0} 个运行中任务</span>
          <span>{checkedAssetIds.length} 个工作台选中项</span>
          <span className="workspace-statusbar__path">
            关闭软件会停止所有任务 · 状态与响应永久保留
          </span>
        </>
      }
    >
      <NewJobPanel
        projectId={projectId}
        workspace={workspace.data}
        checkedAssetIds={checkedAssetIds}
        onCreated={(job) => setSelectedJobId(job.id)}
      />
      <JobList
        jobs={jobItems}
        selectedId={selectedJobId}
        hasMore={Boolean(jobs.hasNextPage)}
        loading={jobs.isLoading}
        loadingMore={jobs.isFetchingNextPage}
        error={jobs.error instanceof Error ? jobs.error.message : null}
        onLoadMore={loadMore}
        onSelect={setSelectedJobId}
      />
      <JobDetailPanel projectId={projectId} jobId={selectedJobId} />
    </WorkspaceFrame>
  );
}
