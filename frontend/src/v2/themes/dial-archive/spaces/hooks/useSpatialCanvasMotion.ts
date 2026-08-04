import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  type KeyboardEventHandler,
  type PointerEventHandler,
  type RefObject,
  type WheelEventHandler,
} from "react";

export interface SpatialCanvasRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface SpatialCanvasCamera {
  readonly initialScale: number;
  readonly minScale: number;
  readonly maxScale: number;
  readonly maxFitScale: number;
  readonly focusScale: number;
  readonly fitInset: number;
  readonly compactFitInset: number;
  readonly compactBreakpoint: number;
  readonly wheelZoomSensitivity: number;
  readonly zoomStep: number;
  readonly keyboardPanStep: number;
  readonly keyboardPanStepFast: number;
  readonly focusDurationMs: number;
}

export interface SpatialCanvasGeometry {
  readonly taskBounds: SpatialCanvasRect;
  readonly overviewBounds: SpatialCanvasRect;
  readonly camera: SpatialCanvasCamera;
  projectRectToMinimap(rect: SpatialCanvasRect): SpatialCanvasRect;
}

interface CanvasTransform {
  x: number;
  y: number;
  scale: number;
}

type CanvasViewMode =
  | { kind: "fit" }
  | { kind: "focus"; worldX: number; worldY: number; scale: number }
  | { kind: "manual" };

interface UseSpatialCanvasMotionOptions {
  geometry: SpatialCanvasGeometry;
  reducedMotion: boolean;
  occlusionRef: RefObject<HTMLElement | null>;
  occlusionActive: boolean;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function isInteractiveTarget(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest("button, input, select, textarea, a"));
}

/**
 * dial-archive 主题内的通用空间画布运动层。
 *
 * 业务页面只提供世界坐标与相机约束；拖拽、缩放、聚焦和遮挡避让由这里统一维护，
 * 避免各空间再次复制一套容易产生手感差异的指针逻辑。
 */
export function useSpatialCanvasMotion({
  geometry,
  reducedMotion,
  occlusionRef,
  occlusionActive,
}: UseSpatialCanvasMotionOptions) {
  const { taskBounds, overviewBounds, camera, projectRectToMinimap } = geometry;
  const viewportRef = useRef<HTMLDivElement>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<HTMLDivElement>(null);
  const scaleReadoutRef = useRef<HTMLOutputElement>(null);
  const minimapViewportRef = useRef<HTMLElement>(null);
  const transformRef = useRef<CanvasTransform>({
    x: 0,
    y: 0,
    scale: camera.initialScale,
  });
  const viewModeRef = useRef<CanvasViewMode>({ kind: "fit" });
  const pointerRef = useRef<{ id: number; x: number; y: number } | null>(null);
  const frameRef = useRef(0);
  const initializedRef = useRef(false);

  const getVisibleViewport = useCallback((): SpatialCanvasRect | null => {
    const viewport = viewportRef.current;
    if (!viewport) return null;
    const visible = { x: 0, y: 0, width: viewport.clientWidth, height: viewport.clientHeight };
    const occlusion = occlusionActive ? occlusionRef.current : null;
    if (!occlusion) return visible;

    const viewportRect = viewport.getBoundingClientRect();
    const occlusionRect = occlusion.getBoundingClientRect();
    const overlapLeft = Math.max(viewportRect.left, occlusionRect.left);
    const overlapTop = Math.max(viewportRect.top, occlusionRect.top);
    const overlapRight = Math.min(viewportRect.right, occlusionRect.right);
    const overlapBottom = Math.min(viewportRect.bottom, occlusionRect.bottom);
    const overlapWidth = Math.max(0, overlapRight - overlapLeft);
    const overlapHeight = Math.max(0, overlapBottom - overlapTop);
    if (overlapWidth === 0 || overlapHeight === 0) return visible;

    const coversMostWidth = overlapWidth >= viewportRect.width * 0.55;
    const coversMostHeight = overlapHeight >= viewportRect.height * 0.55;
    if (coversMostWidth && (!coversMostHeight || overlapWidth >= overlapHeight)) {
      visible.height = Math.max(180, overlapTop - viewportRect.top);
    } else if (coversMostHeight) {
      visible.width = Math.max(280, overlapLeft - viewportRect.left);
    }
    return visible;
  }, [occlusionActive, occlusionRef]);

  const updateMinimapViewport = useCallback(() => {
    const minimapViewport = minimapViewportRef.current;
    const visible = getVisibleViewport();
    if (!minimapViewport || !visible) return;
    const { x, y, scale } = transformRef.current;
    const worldLeft = (visible.x - x) / scale;
    const worldTop = (visible.y - y) / scale;
    const worldRight = (visible.x + visible.width - x) / scale;
    const worldBottom = (visible.y + visible.height - y) / scale;
    const left = clamp(worldLeft, overviewBounds.x, overviewBounds.x + overviewBounds.width);
    const top = clamp(worldTop, overviewBounds.y, overviewBounds.y + overviewBounds.height);
    const right = clamp(worldRight, overviewBounds.x, overviewBounds.x + overviewBounds.width);
    const bottom = clamp(worldBottom, overviewBounds.y, overviewBounds.y + overviewBounds.height);
    if (right <= left || bottom <= top) {
      minimapViewport.style.opacity = "0";
      return;
    }
    const projected = projectRectToMinimap({
      x: left,
      y: top,
      width: right - left,
      height: bottom - top,
    });
    minimapViewport.style.opacity = "1";
    minimapViewport.style.transform = `translate3d(${projected.x}px, ${projected.y}px, 0)`;
    minimapViewport.style.width = `${Math.max(2, projected.width)}px`;
    minimapViewport.style.height = `${Math.max(2, projected.height)}px`;
  }, [getVisibleViewport, overviewBounds, projectRectToMinimap]);

  const renderTransform = useCallback(
    (animate = false) => {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = requestAnimationFrame(() => {
        const surface = surfaceRef.current;
        const scene = sceneRef.current;
        if (!surface || !scene) return;
        const { x, y, scale } = transformRef.current;
        const pixelRatio = window.devicePixelRatio || 1;
        const renderedX = Math.round(x * pixelRatio) / pixelRatio;
        const renderedY = Math.round(y * pixelRatio) / pixelRatio;
        const transition =
          animate && !reducedMotion
            ? `${camera.focusDurationMs}ms var(--dial-archive-ease)`
            : "none";
        surface.style.transition = transition === "none" ? "none" : `transform ${transition}`;
        surface.style.transform = `translate3d(${renderedX}px, ${renderedY}px, 0)`;
        if (CSS.supports("zoom", "1")) {
          scene.style.transition = transition === "none" ? "none" : `zoom ${transition}`;
          scene.style.setProperty("zoom", String(scale));
          scene.style.transform = "none";
        } else {
          scene.style.transition = transition === "none" ? "none" : `transform ${transition}`;
          scene.style.removeProperty("zoom");
          scene.style.transform = `scale(${scale})`;
        }
        if (scaleReadoutRef.current) {
          const readout = `${Math.round(scale * 100)}%`;
          scaleReadoutRef.current.value = readout;
          scaleReadoutRef.current.textContent = readout;
        }
        updateMinimapViewport();
      });
    },
    [camera.focusDurationMs, reducedMotion, updateMinimapViewport],
  );

  const fit = useCallback(
    (animate = true) => {
      const viewport = viewportRef.current;
      const visible = getVisibleViewport();
      if (!viewport || !visible) return;
      const inset =
        viewport.clientWidth < camera.compactBreakpoint ? camera.compactFitInset : camera.fitInset;
      const availableWidth = Math.max(320, visible.width - inset * 2);
      const availableHeight = Math.max(260, visible.height - inset * 2);
      const scale = clamp(
        Math.min(availableWidth / taskBounds.width, availableHeight / taskBounds.height),
        camera.minScale,
        camera.maxFitScale,
      );
      viewModeRef.current = { kind: "fit" };
      transformRef.current = {
        x: visible.x + visible.width / 2 - (taskBounds.x + taskBounds.width / 2) * scale,
        y: visible.y + visible.height / 2 - (taskBounds.y + taskBounds.height / 2) * scale,
        scale,
      };
      renderTransform(animate);
    },
    [camera, getVisibleViewport, renderTransform, taskBounds],
  );

  const zoomAt = useCallback(
    (nextScale: number, clientX?: number, clientY?: number) => {
      const viewport = viewportRef.current;
      const visible = getVisibleViewport();
      if (!viewport || !visible) return;
      const current = transformRef.current;
      const scale = clamp(nextScale, camera.minScale, camera.maxScale);
      const rect = viewport.getBoundingClientRect();
      const anchorX = (clientX ?? rect.left + visible.x + visible.width / 2) - rect.left;
      const anchorY = (clientY ?? rect.top + visible.y + visible.height / 2) - rect.top;
      const worldX = (anchorX - current.x) / current.scale;
      const worldY = (anchorY - current.y) / current.scale;
      viewModeRef.current = { kind: "manual" };
      transformRef.current = {
        x: anchorX - worldX * scale,
        y: anchorY - worldY * scale,
        scale,
      };
      renderTransform(false);
    },
    [camera.maxScale, camera.minScale, getVisibleViewport, renderTransform],
  );

  const panBy = useCallback(
    (x: number, y: number) => {
      viewModeRef.current = { kind: "manual" };
      transformRef.current.x += x;
      transformRef.current.y += y;
      renderTransform(false);
    },
    [renderTransform],
  );

  const focusAt = useCallback(
    (
      worldX: number,
      worldY: number,
      requestedScale: number = camera.focusScale,
      animate = true,
    ) => {
      const visible = getVisibleViewport();
      if (!visible) return;
      const scale = clamp(requestedScale, camera.minScale, camera.maxScale);
      viewModeRef.current = { kind: "focus", worldX, worldY, scale };
      transformRef.current = {
        x: visible.x + visible.width * 0.5 - worldX * scale,
        y: visible.y + visible.height * 0.5 - worldY * scale,
        scale,
      };
      renderTransform(animate);
    },
    [camera.focusScale, camera.maxScale, camera.minScale, getVisibleViewport, renderTransform],
  );

  const syncView = useCallback(
    (animate = false) => {
      const viewMode = viewModeRef.current;
      if (viewMode.kind === "fit") fit(animate);
      else if (viewMode.kind === "focus") {
        focusAt(viewMode.worldX, viewMode.worldY, viewMode.scale, animate);
      } else {
        renderTransform(false);
      }
    },
    [fit, focusAt, renderTransform],
  );

  const onPointerDown = useCallback<PointerEventHandler<HTMLDivElement>>((event) => {
    if (event.button !== 0 || isInteractiveTarget(event.target)) return;
    pointerRef.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.currentTarget.classList.add("is-panning");
  }, []);

  const onPointerMove = useCallback<PointerEventHandler<HTMLDivElement>>(
    (event) => {
      const pointer = pointerRef.current;
      if (!pointer || pointer.id !== event.pointerId) return;
      const deltaX = event.clientX - pointer.x;
      const deltaY = event.clientY - pointer.y;
      pointer.x = event.clientX;
      pointer.y = event.clientY;
      panBy(deltaX, deltaY);
    },
    [panBy],
  );

  const endPointer = useCallback<PointerEventHandler<HTMLDivElement>>((event) => {
    const pointer = pointerRef.current;
    if (!pointer || pointer.id !== event.pointerId) return;
    pointerRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    event.currentTarget.classList.remove("is-panning");
  }, []);

  const onWheel = useCallback<WheelEventHandler<HTMLDivElement>>(
    (event) => {
      event.preventDefault();
      const viewport = viewportRef.current;
      const deltaUnit =
        event.deltaMode === WheelEvent.DOM_DELTA_LINE
          ? 16
          : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
            ? (viewport?.clientHeight ?? 800)
            : 1;
      if (event.shiftKey) {
        panBy(-(event.deltaX + event.deltaY) * deltaUnit, 0);
        return;
      }
      zoomAt(
        transformRef.current.scale *
          Math.exp(-event.deltaY * deltaUnit * camera.wheelZoomSensitivity),
        event.clientX,
        event.clientY,
      );
    },
    [camera.wheelZoomSensitivity, panBy, zoomAt],
  );

  const onKeyDown = useCallback<KeyboardEventHandler<HTMLDivElement>>(
    (event) => {
      const step = event.shiftKey ? camera.keyboardPanStepFast : camera.keyboardPanStep;
      if (event.key === "ArrowLeft") panBy(step, 0);
      else if (event.key === "ArrowRight") panBy(-step, 0);
      else if (event.key === "ArrowUp") panBy(0, step);
      else if (event.key === "ArrowDown") panBy(0, -step);
      else if (event.key === "+" || event.key === "=") {
        zoomAt(transformRef.current.scale + camera.zoomStep);
      } else if (event.key === "-") zoomAt(transformRef.current.scale - camera.zoomStep);
      else if (event.key === "0") fit();
      else return;
      event.preventDefault();
    },
    [camera, fit, panBy, zoomAt],
  );

  const zoomIn = useCallback(
    () => zoomAt(transformRef.current.scale + camera.zoomStep),
    [camera.zoomStep, zoomAt],
  );
  const zoomOut = useCallback(
    () => zoomAt(transformRef.current.scale - camera.zoomStep),
    [camera.zoomStep, zoomAt],
  );

  useLayoutEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;
    fit(false);
  }, [fit]);
  useLayoutEffect(() => {
    syncView(false);
  }, [occlusionActive, syncView]);
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => syncView(false));
    observer.observe(viewport);
    const occlusion = occlusionActive ? occlusionRef.current : null;
    if (occlusion) observer.observe(occlusion);
    return () => observer.disconnect();
  }, [occlusionActive, occlusionRef, syncView]);
  useEffect(
    () => () => {
      cancelAnimationFrame(frameRef.current);
    },
    [],
  );

  return {
    viewportRef,
    surfaceRef,
    sceneRef,
    scaleReadoutRef,
    minimapViewportRef,
    onPointerDown,
    onPointerMove,
    onPointerUp: endPointer,
    onPointerCancel: endPointer,
    onWheel,
    onKeyDown,
    fit,
    focusAt,
    zoomIn,
    zoomOut,
  };
}
