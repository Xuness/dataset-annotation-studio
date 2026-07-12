import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";

import { useJobs } from "../../features/jobs/hooks";
import { useRescanWorkspace, useWorkspace } from "../../features/workspaces/hooks";
import { useAppStore } from "../../shared/store/appStore";
import { Spinner } from "../../shared/ui/Spinner";
import { NavigationRail } from "../workspace/components/NavigationRail";
import { WorkspaceTopbar } from "../workspace/components/WorkspaceTopbar";
import { JobDetailPanel } from "./components/JobDetailPanel";
import { JobList } from "./components/JobList";
import { NewJobPanel } from "./components/NewJobPanel";
import "../workspace/workspace.css";
import "./jobs.css";
import "./job-detail.css";

export function JobsPage() {
  const { projectId = "" } = useParams();
  const workspace = useWorkspace(projectId);
  const jobs = useJobs(projectId);
  const rescan = useRescanWorkspace(projectId);
  const checkedAssetIds = useAppStore((state) => state.checkedAssetIds);
  const setActiveProject = useAppStore((state) => state.setActiveProject);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);

  useEffect(() => setActiveProject(projectId), [projectId, setActiveProject]);
  useEffect(() => {
    if (!selectedJobId && jobs.data?.length) setSelectedJobId(jobs.data[0].id);
  }, [jobs.data, selectedJobId]);

  if (!workspace.data)
    return (
      <div className="workspace-loading">
        <Spinner />
        <p>正在打开任务中心…</p>
      </div>
    );

  const activeJobs =
    jobs.data?.filter((job) => ["queued", "running", "stopping"].includes(job.status)).length ?? 0;
  return (
    <main className="workspace-page">
      <WorkspaceTopbar
        workspace={workspace.data}
        rescanning={rescan.isPending}
        onRescan={() => void rescan.mutateAsync()}
      />
      <div className="workspace-body jobs-workspace-body">
        <NavigationRail projectId={projectId} active="jobs" />
        <NewJobPanel
          projectId={projectId}
          workspace={workspace.data}
          checkedAssetIds={checkedAssetIds}
          onCreated={(job) => setSelectedJobId(job.id)}
        />
        <JobList jobs={jobs.data ?? []} selectedId={selectedJobId} onSelect={setSelectedJobId} />
        <JobDetailPanel projectId={projectId} jobId={selectedJobId} />
      </div>
      <footer className="workspace-statusbar">
        <span>{activeJobs} 个运行中任务</span>
        <span>{checkedAssetIds.length} 个工作台选中项</span>
        <span className="workspace-statusbar__path">
          关闭软件会停止所有任务 · 状态与响应永久保留
        </span>
      </footer>
    </main>
  );
}
