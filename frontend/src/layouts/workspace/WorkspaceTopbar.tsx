import { ChevronLeft, FolderOpen, RefreshCw, Settings2, SquareActivity } from "lucide-react";
import { useNavigate } from "react-router-dom";

import { useExportOperations } from "../../features/exports/hooks";
import { useJobs } from "../../features/jobs/hooks";
import type { WorkspaceSummary } from "../../shared/api/types";
import { useLegacyUnsavedChangesGuard } from "../../legacy/hooks/useLegacyUnsavedChangesGuard";
import { Button } from "../../shared/ui/Button";
import { InterfaceScaleControl } from "../../shared/ui/InterfaceScaleControl";
import { Spinner } from "../../shared/ui/Spinner";

interface WorkspaceTopbarProps {
  workspace: WorkspaceSummary;
  rescanning: boolean;
  rescanDisabled?: boolean;
  onRescan: () => void;
}

export function WorkspaceTopbar({
  workspace,
  rescanning,
  rescanDisabled = false,
  onRescan,
}: WorkspaceTopbarProps) {
  const navigate = useNavigate();
  const { confirmDiscard } = useLegacyUnsavedChangesGuard();
  const jobs = useJobs(workspace.project_id);
  const exports = useExportOperations(workspace.project_id);
  const activeExportCount =
    exports.data?.filter((operation) =>
      ["queued", "running", "stopping"].includes(operation.status),
    ).length ?? 0;
  const activeJobCount = (jobs.data?.length ?? 0) + activeExportCount;

  function leaveTo(path: string) {
    void (async () => {
      if (await confirmDiscard()) navigate(path);
    })();
  }

  return (
    <header className="workspace-topbar" data-surface-region="chrome">
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
          {jobs.isError || exports.isError
            ? "任务状态读取失败"
            : activeJobCount
              ? `${activeJobCount} 个任务运行中`
              : "当前没有运行中的任务"}
        </span>
        <InterfaceScaleControl />
        <Button
          icon={rescanning ? <Spinner /> : <RefreshCw size={15} />}
          onClick={onRescan}
          disabled={rescanning || rescanDisabled || activeJobCount > 0}
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
