import type { RefObject } from "react";

import { useSpatialCanvasMotion } from "../../hooks/useSpatialCanvasMotion";
import {
  PREPARATION_CANVAS_LAYOUT,
  projectPreparationCanvasRectToMinimap,
} from "../model/preparationCanvasLayout";

interface UsePreparationCanvasMotionOptions {
  reducedMotion: boolean;
  occlusionRef: RefObject<HTMLElement | null>;
  occlusionActive: boolean;
}

const PREPARATION_CANVAS_GEOMETRY = {
  taskBounds: PREPARATION_CANVAS_LAYOUT.taskBounds,
  overviewBounds: PREPARATION_CANVAS_LAYOUT.overviewBounds,
  camera: PREPARATION_CANVAS_LAYOUT.camera,
  projectRectToMinimap: projectPreparationCanvasRectToMinimap,
} as const;

/**
 * 保留整备空间的领域入口；指针、缩放和遮挡避让由主题共享空间运动层实现。
 */
export function usePreparationCanvasMotion(options: UsePreparationCanvasMotionOptions) {
  return useSpatialCanvasMotion({
    geometry: PREPARATION_CANVAS_GEOMETRY,
    ...options,
  });
}
