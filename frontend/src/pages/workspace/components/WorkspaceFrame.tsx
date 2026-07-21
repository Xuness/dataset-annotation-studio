import type { CSSProperties, ReactNode, Ref } from "react";

import type { WorkspaceSummary } from "../../../shared/api/types";
import { NavigationRail, type WorkspaceSection } from "./NavigationRail";
import { WorkspaceTopbar } from "./WorkspaceTopbar";

interface WorkspaceFrameProps {
  workspace: WorkspaceSummary;
  projectId: string;
  active: WorkspaceSection;
  rescanning: boolean;
  rescanDisabled?: boolean;
  onRescan: () => void;
  bodyClassName?: string;
  bodyStyle?: CSSProperties;
  bodyRef?: Ref<HTMLDivElement>;
  children: ReactNode;
  statusbar: ReactNode;
}

export function WorkspaceFrame({
  workspace,
  projectId,
  active,
  rescanning,
  rescanDisabled = false,
  onRescan,
  bodyClassName = "",
  bodyStyle,
  bodyRef,
  children,
  statusbar,
}: WorkspaceFrameProps) {
  return (
    <main className="workspace-page">
      <div className="workspace-atmosphere" aria-hidden="true" />
      <WorkspaceTopbar
        workspace={workspace}
        rescanning={rescanning}
        rescanDisabled={rescanDisabled}
        onRescan={onRescan}
      />
      <div ref={bodyRef} className={`workspace-body ${bodyClassName}`.trim()} style={bodyStyle}>
        <NavigationRail projectId={projectId} active={active} />
        {children}
      </div>
      <footer className="workspace-statusbar" data-surface-region="chrome">
        {statusbar}
      </footer>
    </main>
  );
}
