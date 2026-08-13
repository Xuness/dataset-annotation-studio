import { useEffect, useRef } from "react";

import { useCandidateIds } from "../../features/assets/hooks";
import { useWorkspaceSelectionStore } from "../../shared/store/workspaceSelectionStore";

/**
 * Restore persisted candidate membership into the transient checkbox workspace.
 *
 * Hydration is intentionally a one-time merge for each workspace visit. After
 * that, checkboxes remain an editable draft and candidate membership changes
 * only through the explicit candidate actions.
 */
export function useCandidateSelectionHydration(projectId: string | null): void {
  const hydratedProjectRef = useRef<string | null>(null);
  const candidateIds = useCandidateIds(projectId ?? "", Boolean(projectId));
  const setActiveProject = useWorkspaceSelectionStore((state) => state.setActiveProject);
  const setAssetsChecked = useWorkspaceSelectionStore((state) => state.setAssetsChecked);

  useEffect(() => {
    if (!projectId) {
      hydratedProjectRef.current = null;
      return;
    }
    setActiveProject(projectId);
  }, [projectId, setActiveProject]);

  useEffect(() => {
    if (!projectId || !candidateIds.data || hydratedProjectRef.current === projectId) return;
    setActiveProject(projectId);
    setAssetsChecked(candidateIds.data.ids, true);
    hydratedProjectRef.current = projectId;
  }, [candidateIds.data, projectId, setActiveProject, setAssetsChecked]);
}
