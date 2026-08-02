import { useCallback, useMemo, useState } from "react";

import {
  useOpenWorkspace,
  useRecentWorkspaces,
  useRemoveRecentWorkspace,
} from "../../../../features/workspaces/hooks";
import { openLocalFolder } from "../../../../shared/desktop/openLocalFolder";
import { pickWorkspaceFolder } from "../../../../shared/desktop/pickFolder";
import { useWorkspaceSelectionStore } from "../../../../shared/store/workspaceSelectionStore";
import type { ArchiveSpaceContent } from "../spacePageModel";
import { toArchiveProjectRecord } from "./archiveProjectModel";

function describeError(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

export function useArchiveSpaceController(): ArchiveSpaceContent {
  const recent = useRecentWorkspaces();
  const openWorkspace = useOpenWorkspace();
  const removeRecent = useRemoveRecentWorkspace();
  const activeProjectId = useWorkspaceSelectionStore((state) => state.projectId);
  const setActiveProject = useWorkspaceSelectionStore((state) => state.setActiveProject);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  const projects = useMemo(() => (recent.data ?? []).map(toArchiveProjectRecord), [recent.data]);

  const registerProject = useCallback(async () => {
    setActionMessage(null);
    try {
      const path = await pickWorkspaceFolder();
      if (!path) return null;
      const response = await openWorkspace.mutateAsync(path);
      setActiveProject(response.workspace.project_id);
      await recent.refetch();
      return response.workspace.project_id;
    } catch (reason) {
      setActionMessage(`无法登记这个工作区：${describeError(reason)}`);
      return null;
    }
  }, [openWorkspace, recent, setActiveProject]);

  const loadProject = useCallback(
    (projectId: string) => {
      setActionMessage(null);
      setActiveProject(projectId);
    },
    [setActiveProject],
  );

  const revealProject = useCallback(
    async (projectId: string) => {
      setActionMessage(null);
      const project = projects.find((candidate) => candidate.id === projectId);
      if (!project) {
        setActionMessage("项目已不在当前登记索引中。");
        return;
      }
      try {
        await openLocalFolder(project.rootPath);
      } catch (reason) {
        setActionMessage(`无法打开项目目录：${describeError(reason)}`);
      }
    },
    [projects],
  );

  const removeProject = useCallback(
    async (projectId: string) => {
      setActionMessage(null);
      try {
        await removeRecent.mutateAsync(projectId);
        if (activeProjectId === projectId) setActiveProject(null);
      } catch (reason) {
        setActionMessage(`无法移除项目登记：${describeError(reason)}`);
      }
    },
    [activeProjectId, removeRecent, setActiveProject],
  );

  const queryMessage = recent.isError ? `无法读取项目登记：${describeError(recent.error)}` : null;

  return {
    kind: "archive",
    status: recent.isPending ? "loading" : recent.isError ? "error" : "ready",
    projects,
    activeProjectId,
    message: actionMessage ?? queryMessage,
    registering: openWorkspace.isPending,
    removingProjectId: removeRecent.isPending ? (removeRecent.variables ?? null) : null,
    registerProject,
    loadProject,
    revealProject,
    removeProject,
    clearMessage: () => setActionMessage(null),
  };
}
