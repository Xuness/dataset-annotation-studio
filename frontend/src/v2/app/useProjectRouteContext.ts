import { useCallback, useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import { useWorkspaceSelectionStore } from "../../shared/store/workspaceSelectionStore";
import { readProjectId, replaceProjectIdInHref } from "./routeState";

export function useProjectRouteContext() {
  const location = useLocation();
  const navigate = useNavigate();
  const storedProjectId = useWorkspaceSelectionStore((state) => state.projectId);
  const setActiveProject = useWorkspaceSelectionStore((state) => state.setActiveProject);
  const projectId = readProjectId(location.search);

  useEffect(() => {
    if (storedProjectId !== projectId) setActiveProject(projectId);
  }, [projectId, setActiveProject, storedProjectId]);

  const setProjectId = useCallback(
    (nextProjectId: string | null) => {
      const href = replaceProjectIdInHref(location.pathname, location.search, nextProjectId);
      if (href !== `${location.pathname}${location.search}`) navigate(href, { replace: true });
    },
    [location.pathname, location.search, navigate],
  );

  return { projectId, setProjectId };
}
