import { ChevronLeft, FolderOpen, RefreshCw, Settings2, SquareActivity } from "lucide-react";
import { useNavigate } from "react-router-dom";

import { useJobs } from "../../../features/jobs/hooks";
import { useUnsavedChangesGuard } from "../../../shared/desktop/useUnsavedChanges";
import type { WorkspaceSummary } from "../../../shared/api/types";
import { Button } from "../../../shared/ui/Button";
import { InterfaceScaleControl } from "../../../shared/ui/InterfaceScaleControl";
import { Spinner } from "../../../shared/ui/Spinner";

interface WorkspaceTopbarProps {
  workspace: WorkspaceSummary;
  rescanning: boolean;
  onRescan: () => void;
}

export function WorkspaceTopbar({ workspace, rescanning, onRescan }: WorkspaceTopbarProps) {
  const navigate = useNavigate();
  const { confirmDiscard } = useUnsavedChangesGuard();
  const jobs = useJobs(workspace.project_id);
  const activeJobCount = jobs.data?.length ?? 0;

  function leaveTo(path: string) {
    void (async () => {
      if (await confirmDiscard()) navigate(path);
    })();
  }

  return (
    <header className="workspace-topbar">
      <div className="workspace-topbar__identity">
        <button className="icon-button" onClick={() => leaveTo("/")} title="返回项目首页">
          <ChevronLeft size={17} />
        </button>
        <span className="workspace-glyph" aria-hidden="true">
          <span />
        </span>
        <div>
          <strong>{workspace.name}</strong>
          <small>{workspace.root_path}</small>
        </div>
      </div>
      <div className="workspace-topbar__actions">
        <span className="quiet-stat">
          <SquareActivity size={14} />
          {jobs.isError
            ? "任务状态读取失败"
            : activeJobCount
              ? `${activeJobCount} 个任务运行中`
              : "当前没有运行中的任务"}
        </span>
        <InterfaceScaleControl />
        <Button
          icon={rescanning ? <Spinner /> : <RefreshCw size={15} />}
          onClick={onRescan}
          disabled={rescanning}
        >
          重新扫描
        </Button>
        <Button icon={<Settings2 size={15} />} onClick={() => leaveTo("/presets")}>
          预设
        </Button>
        <Button icon={<FolderOpen size={15} />} onClick={() => leaveTo("/")}>
          项目
        </Button>
      </div>
    </header>
  );
}
