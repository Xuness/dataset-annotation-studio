import { useCallback, useEffect, useRef, type PointerEventHandler, type RefObject } from "react";

import { ANNOTATION_STAGE_LAYOUT } from "../model/annotationStageLayout";
import { clampStageValue } from "../model/annotationStageViewport";

interface StageCameraPoint {
  x: number;
  y: number;
}

interface StageCameraPointer {
  id: number;
  originX: number;
  originY: number;
  lastX: number;
  lastY: number;
  moved: boolean;
}

function cameraLockedTarget(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    Boolean(
      target.closest(
        "button, input, select, textarea, a, [contenteditable='true'], [data-stage-camera-lock]",
      ),
    )
  );
}

function setCameraVariables(root: HTMLElement, point: StageCameraPoint): void {
  const { camera } = ANNOTATION_STAGE_LAYOUT;
  root.style.setProperty("--dial-archive-stage-camera-x", `${point.x * camera.sceneDepth}px`);
  root.style.setProperty("--dial-archive-stage-camera-y", `${point.y * camera.sceneDepth}px`);
  root.style.setProperty(
    "--dial-archive-stage-camera-evidence-x",
    `${point.x * camera.evidenceDepth}px`,
  );
  root.style.setProperty(
    "--dial-archive-stage-camera-evidence-y",
    `${point.y * camera.evidenceDepth}px`,
  );
  root.style.setProperty("--dial-archive-stage-camera-ghost-x", `${point.x * camera.ghostDepth}px`);
  root.style.setProperty("--dial-archive-stage-camera-ghost-y", `${point.y * camera.ghostDepth}px`);
}

/** 有界外层镜头；只从空白画布起手，组件与主图均会锁住该手势。 */
export function useStageCamera(rootRef: RefObject<HTMLDivElement | null>, reducedMotion: boolean) {
  const pointRef = useRef<StageCameraPoint>({ x: 0, y: 0 });
  const pointerRef = useRef<StageCameraPointer | null>(null);
  const resetTimerRef = useRef(0);

  const paint = useCallback(() => {
    const root = rootRef.current;
    if (root) setCameraVariables(root, pointRef.current);
  }, [rootRef]);

  const panBy = useCallback(
    (deltaX: number, deltaY: number) => {
      const { maxOffsetX, maxOffsetY } = ANNOTATION_STAGE_LAYOUT.camera;
      pointRef.current = {
        x: clampStageValue(pointRef.current.x + deltaX, -maxOffsetX, maxOffsetX),
        y: clampStageValue(pointRef.current.y + deltaY, -maxOffsetY, maxOffsetY),
      };
      paint();
    },
    [paint],
  );

  const onPointerDown = useCallback<PointerEventHandler<HTMLDivElement>>((event) => {
    if (event.button !== 0 || cameraLockedTarget(event.target)) return;
    pointerRef.current = {
      id: event.pointerId,
      originX: event.clientX,
      originY: event.clientY,
      lastX: event.clientX,
      lastY: event.clientY,
      moved: false,
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
    event.currentTarget.focus({ preventScroll: true });
  }, []);

  const onPointerMove = useCallback<PointerEventHandler<HTMLDivElement>>(
    (event) => {
      const pointer = pointerRef.current;
      if (!pointer || pointer.id !== event.pointerId) return;
      const deltaX = event.clientX - pointer.lastX;
      const deltaY = event.clientY - pointer.lastY;
      pointer.lastX = event.clientX;
      pointer.lastY = event.clientY;
      if (
        !pointer.moved &&
        Math.hypot(event.clientX - pointer.originX, event.clientY - pointer.originY) >=
          ANNOTATION_STAGE_LAYOUT.camera.dragThreshold
      ) {
        pointer.moved = true;
        event.currentTarget.classList.add("is-camera-dragging");
      }
      if (pointer.moved) panBy(deltaX, deltaY);
    },
    [panBy],
  );

  const endPointer = useCallback<PointerEventHandler<HTMLDivElement>>((event) => {
    const pointer = pointerRef.current;
    if (!pointer || pointer.id !== event.pointerId) return;
    pointerRef.current = null;
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture?.(event.pointerId);
    }
    event.currentTarget.classList.remove("is-camera-dragging");
  }, []);

  const reset = useCallback(() => {
    const root = rootRef.current;
    if (!root) return;
    window.clearTimeout(resetTimerRef.current);
    root.classList.toggle("is-camera-resetting", !reducedMotion);
    pointRef.current = { x: 0, y: 0 };
    paint();
    if (!reducedMotion) {
      resetTimerRef.current = window.setTimeout(() => {
        root.classList.remove("is-camera-resetting");
      }, ANNOTATION_STAGE_LAYOUT.camera.resetDurationMs);
    }
  }, [paint, reducedMotion, rootRef]);

  useEffect(() => {
    paint();
    return () => {
      window.clearTimeout(resetTimerRef.current);
    };
  }, [paint]);

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp: endPointer,
    onPointerCancel: endPointer,
    reset,
  };
}
