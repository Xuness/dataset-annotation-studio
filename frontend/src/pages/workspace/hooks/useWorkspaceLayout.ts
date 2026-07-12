import { useEffect, useState } from "react";

export interface WorkspaceLayout {
  assetPaneWidth: number;
  inspectorPaneWidth: number;
  imagePaneRatio: number;
}

export const DEFAULT_WORKSPACE_LAYOUT: WorkspaceLayout = {
  assetPaneWidth: 278,
  inspectorPaneWidth: 310,
  imagePaneRatio: 66,
};

export const WORKSPACE_LAYOUT_LIMITS = {
  assetPaneMin: 220,
  assetPaneMax: 520,
  inspectorPaneMin: 240,
  inspectorPaneMax: 560,
  imagePaneMin: 35,
  imagePaneMax: 75,
  navigationWidth: 52,
  resizeHandlesWidth: 10,
  mediaPaneMin: 340,
} as const;

const STORAGE_PREFIX = "dataset-studio.workspace-layout";

export function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function readLayout(projectId: string): WorkspaceLayout {
  try {
    const stored = window.localStorage.getItem(`${STORAGE_PREFIX}.${projectId}`);
    if (!stored) return DEFAULT_WORKSPACE_LAYOUT;
    const value = JSON.parse(stored) as Partial<WorkspaceLayout>;
    return {
      assetPaneWidth: clamp(
        value.assetPaneWidth ?? 278,
        WORKSPACE_LAYOUT_LIMITS.assetPaneMin,
        WORKSPACE_LAYOUT_LIMITS.assetPaneMax,
      ),
      inspectorPaneWidth: clamp(
        value.inspectorPaneWidth ?? 310,
        WORKSPACE_LAYOUT_LIMITS.inspectorPaneMin,
        WORKSPACE_LAYOUT_LIMITS.inspectorPaneMax,
      ),
      imagePaneRatio: clamp(
        value.imagePaneRatio ?? 66,
        WORKSPACE_LAYOUT_LIMITS.imagePaneMin,
        WORKSPACE_LAYOUT_LIMITS.imagePaneMax,
      ),
    };
  } catch {
    return DEFAULT_WORKSPACE_LAYOUT;
  }
}

export function fitWorkspaceLayoutToWidth(
  layout: WorkspaceLayout,
  containerWidth: number,
): WorkspaceLayout {
  const availableWidth = Math.max(
    WORKSPACE_LAYOUT_LIMITS.assetPaneMin + WORKSPACE_LAYOUT_LIMITS.inspectorPaneMin,
    containerWidth -
      WORKSPACE_LAYOUT_LIMITS.navigationWidth -
      WORKSPACE_LAYOUT_LIMITS.resizeHandlesWidth -
      WORKSPACE_LAYOUT_LIMITS.mediaPaneMin,
  );
  const occupiedWidth = layout.assetPaneWidth + layout.inspectorPaneWidth;
  if (occupiedWidth <= availableWidth) return layout;

  const overflow = occupiedWidth - availableWidth;
  const assetCapacity = layout.assetPaneWidth - WORKSPACE_LAYOUT_LIMITS.assetPaneMin;
  const inspectorCapacity = layout.inspectorPaneWidth - WORKSPACE_LAYOUT_LIMITS.inspectorPaneMin;
  const totalCapacity = assetCapacity + inspectorCapacity;
  if (totalCapacity <= 0) return layout;

  const assetReduction = Math.min(assetCapacity, overflow * (assetCapacity / totalCapacity));
  const inspectorReduction = Math.min(inspectorCapacity, overflow - assetReduction);
  return {
    ...layout,
    assetPaneWidth: Math.round(layout.assetPaneWidth - assetReduction),
    inspectorPaneWidth: Math.round(layout.inspectorPaneWidth - inspectorReduction),
  };
}

export function useWorkspaceLayout(projectId: string) {
  const [layout, setLayout] = useState(() => readLayout(projectId));

  useEffect(() => {
    window.localStorage.setItem(`${STORAGE_PREFIX}.${projectId}`, JSON.stringify(layout));
  }, [layout, projectId]);

  return { layout, setLayout };
}
