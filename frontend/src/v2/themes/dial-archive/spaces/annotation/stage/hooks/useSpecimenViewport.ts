import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  type KeyboardEventHandler,
  type PointerEventHandler,
  type WheelEventHandler,
} from "react";

import type { AnnotationStageAsset } from "../../../../../../pages/spaces/spacePageModel";
import { ANNOTATION_STAGE_LAYOUT } from "../model/annotationStageLayout";
import {
  calculateStageViewportFitScale,
  clampStageViewportTransform,
  zoomStageViewportAt,
  type StageViewportSize,
  type StageViewportTransform,
} from "../model/annotationStageViewport";

type ViewMode = "fit" | "actual" | "manual";

interface StageViewportPointer {
  id: number;
  lastX: number;
  lastY: number;
  originX: number;
  originY: number;
  moved: boolean;
}

interface UseSpecimenViewportOptions {
  asset: AnnotationStageAsset | null;
  reducedMotion: boolean;
}

function elementSize(element: HTMLElement | null): StageViewportSize {
  if (!element) return { width: 0, height: 0 };
  const bounds = element.getBoundingClientRect();
  return {
    width: element.clientWidth || bounds.width,
    height: element.clientHeight || bounds.height,
  };
}

function formatScale(scale: number): string {
  const percent = scale * 100;
  return percent < 1 ? "<1%" : `${Math.round(percent)}%`;
}

/** 主图私有观察窗：缩放与平移只影响真彩图片，不改动外层施工场镜头。 */
export function useSpecimenViewport({ asset, reducedMotion }: UseSpecimenViewportOptions) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const scaleReadoutRef = useRef<HTMLOutputElement>(null);
  const transformRef = useRef<StageViewportTransform>({ x: 0, y: 0, scale: 1 });
  const modeRef = useRef<ViewMode>("fit");
  const pointerRef = useRef<StageViewportPointer | null>(null);
  const suppressClickRef = useRef(false);
  const settleTimerRef = useRef(0);

  const imageSize = useMemo<StageViewportSize>(
    () => ({ width: asset?.width ?? 0, height: asset?.height ?? 0 }),
    [asset?.height, asset?.width],
  );

  const renderTransform = useCallback(
    (animate = false) => {
      const viewport = viewportRef.current;
      const surface = surfaceRef.current;
      const image = imageRef.current;
      if (!viewport || !surface || !image || !asset) return;
      const transform = clampStageViewportTransform(
        transformRef.current,
        elementSize(viewport),
        imageSize,
      );
      transformRef.current = transform;
      const ratio = window.devicePixelRatio || 1;
      const x = Math.round(transform.x * ratio) / ratio;
      const y = Math.round(transform.y * ratio) / ratio;
      surface.style.transform = `translate3d(${x}px, ${y}px, 0)`;
      image.style.width = `${imageSize.width}px`;
      image.style.height = `${imageSize.height}px`;
      image.style.transform = `translate3d(-50%, -50%, 0) scale(${transform.scale})`;
      viewport.dataset.viewMode = modeRef.current;
      if (scaleReadoutRef.current) {
        const reading = formatScale(transform.scale);
        scaleReadoutRef.current.value = reading;
        scaleReadoutRef.current.textContent = reading;
      }

      window.clearTimeout(settleTimerRef.current);
      viewport.classList.toggle("is-settling", animate && !reducedMotion);
      if (animate && !reducedMotion) {
        settleTimerRef.current = window.setTimeout(() => {
          viewport.classList.remove("is-settling");
        }, ANNOTATION_STAGE_LAYOUT.viewport.settleDurationMs);
      }
    },
    [asset, imageSize, reducedMotion],
  );

  const fit = useCallback(
    (animate = true) => {
      if (!asset) return;
      modeRef.current = "fit";
      transformRef.current = {
        x: 0,
        y: 0,
        scale: calculateStageViewportFitScale(elementSize(viewportRef.current), imageSize),
      };
      renderTransform(animate);
    },
    [asset, imageSize, renderTransform],
  );

  const actual = useCallback(
    (animate = true) => {
      if (!asset) return;
      modeRef.current = "actual";
      transformRef.current = { x: 0, y: 0, scale: 1 };
      renderTransform(animate);
    },
    [asset, renderTransform],
  );

  const zoomAt = useCallback(
    (requestedScale: number, clientX?: number, clientY?: number) => {
      const viewport = viewportRef.current;
      if (!viewport || !asset) return;
      const bounds = viewport.getBoundingClientRect();
      modeRef.current = "manual";
      transformRef.current = zoomStageViewportAt(
        transformRef.current,
        requestedScale,
        {
          x: (clientX ?? bounds.left + bounds.width / 2) - bounds.left,
          y: (clientY ?? bounds.top + bounds.height / 2) - bounds.top,
        },
        elementSize(viewport),
        imageSize,
      );
      renderTransform(false);
    },
    [asset, imageSize, renderTransform],
  );

  const panBy = useCallback(
    (deltaX: number, deltaY: number) => {
      const viewport = viewportRef.current;
      if (!viewport || !asset) return;
      modeRef.current = "manual";
      transformRef.current = clampStageViewportTransform(
        {
          ...transformRef.current,
          x: transformRef.current.x + deltaX,
          y: transformRef.current.y + deltaY,
        },
        elementSize(viewport),
        imageSize,
      );
      renderTransform(false);
    },
    [asset, imageSize, renderTransform],
  );

  const onPointerDown = useCallback<PointerEventHandler<HTMLDivElement>>((event) => {
    if (event.button !== 0) return;
    pointerRef.current = {
      id: event.pointerId,
      lastX: event.clientX,
      lastY: event.clientY,
      originX: event.clientX,
      originY: event.clientY,
      moved: false,
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
    event.currentTarget.classList.add("is-panning");
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
          ANNOTATION_STAGE_LAYOUT.viewport.dragThreshold
      ) {
        pointer.moved = true;
      }
      if (!pointer.moved) return;
      event.preventDefault();
      panBy(deltaX, deltaY);
    },
    [panBy],
  );

  const endPointer = useCallback<PointerEventHandler<HTMLDivElement>>((event) => {
    const pointer = pointerRef.current;
    if (!pointer || pointer.id !== event.pointerId) return;
    suppressClickRef.current = pointer.moved;
    pointerRef.current = null;
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture?.(event.pointerId);
    }
    event.currentTarget.classList.remove("is-panning");
  }, []);

  const onWheel = useCallback<WheelEventHandler<HTMLDivElement>>(
    (event) => {
      if (!asset || event.deltaY === 0) return;
      event.preventDefault();
      event.stopPropagation();
      const viewport = viewportRef.current;
      const deltaUnit =
        event.deltaMode === WheelEvent.DOM_DELTA_LINE
          ? 16
          : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
            ? (viewport?.clientHeight ?? 800)
            : 1;
      zoomAt(
        transformRef.current.scale *
          Math.exp(
            -event.deltaY * deltaUnit * ANNOTATION_STAGE_LAYOUT.viewport.wheelZoomSensitivity,
          ),
        event.clientX,
        event.clientY,
      );
    },
    [asset, zoomAt],
  );

  const zoomIn = useCallback(
    () => zoomAt(transformRef.current.scale * (1 + ANNOTATION_STAGE_LAYOUT.viewport.zoomStep)),
    [zoomAt],
  );
  const zoomOut = useCallback(
    () => zoomAt(transformRef.current.scale / (1 + ANNOTATION_STAGE_LAYOUT.viewport.zoomStep)),
    [zoomAt],
  );
  const toggleActual = useCallback(() => {
    if (Math.abs(transformRef.current.scale - 1) < 0.01) fit();
    else actual();
  }, [actual, fit]);

  const onKeyDown = useCallback<KeyboardEventHandler<HTMLDivElement>>(
    (event) => {
      if (event.key === "+" || event.key === "=") zoomIn();
      else if (event.key === "-") zoomOut();
      else if (event.key === "0" || event.key.toLowerCase() === "f") fit();
      else if (event.key === "1") actual();
      else return;
      event.preventDefault();
      event.stopPropagation();
    },
    [actual, fit, zoomIn, zoomOut],
  );

  const consumeSuppressedClick = useCallback(() => {
    const suppressed = suppressClickRef.current;
    suppressClickRef.current = false;
    return suppressed;
  }, []);

  useLayoutEffect(() => fit(false), [asset?.id, fit]);
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      if (modeRef.current === "fit") fit(false);
      else renderTransform(false);
    });
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [fit, renderTransform]);
  useEffect(
    () => () => {
      window.clearTimeout(settleTimerRef.current);
    },
    [],
  );

  return {
    viewportRef,
    surfaceRef,
    imageRef,
    scaleReadoutRef,
    onPointerDown,
    onPointerMove,
    onPointerUp: endPointer,
    onPointerCancel: endPointer,
    onWheel,
    onKeyDown,
    fit,
    actual,
    zoomIn,
    zoomOut,
    toggleActual,
    consumeSuppressedClick,
  };
}
