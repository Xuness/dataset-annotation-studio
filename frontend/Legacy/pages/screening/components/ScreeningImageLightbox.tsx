import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type WheelEvent,
} from "react";
import { Maximize2, Minus, Move, Plus, Scan, X } from "lucide-react";

import {
  clampScreeningViewerOffset,
  clampScreeningViewerZoom,
  screeningViewerDisplaySize,
  screeningViewerFitScale,
  screeningViewerMaxZoom,
  SCREENING_VIEWER_ZOOM_STEP,
  zoomScreeningViewerAt,
  type ViewerPoint,
  type ViewerSize,
} from "../../../../src/application/screening/imageViewerState";
import { imageUrl } from "../../../../src/features/assets/api";
import type { ScreeningItem } from "../../../../src/shared/api/types";
import { ModalLayer } from "../../../shared/ui/ModalLayer";

interface ScreeningImageLightboxProps {
  projectId: string;
  operationId: string;
  item: ScreeningItem | null;
  onClose: () => void;
}

const VIEWPORT_FALLBACK: ViewerSize = { width: 1280, height: 720 };

function itemFilename(item: ScreeningItem): string {
  return item.source_relative_path.split("/").at(-1) ?? item.source_relative_path;
}

export function ScreeningImageLightbox({
  projectId,
  operationId,
  item,
  onClose,
}: ScreeningImageLightboxProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const panRef = useRef<{
    pointerId: number;
    start: ViewerPoint;
    offset: ViewerPoint;
  } | null>(null);
  const [viewport, setViewport] = useState<ViewerSize>(VIEWPORT_FALLBACK);
  const [imageSize, setImageSize] = useState<ViewerSize>({ width: 1, height: 1 });
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState<ViewerPoint>({ x: 0, y: 0 });
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [panning, setPanning] = useState(false);

  useEffect(() => {
    if (!item) return;
    setImageSize({
      width: Math.max(1, item.image_width ?? 1),
      height: Math.max(1, item.image_height ?? 1),
    });
    setZoom(1);
    setOffset({ x: 0, y: 0 });
    setLoaded(false);
    setFailed(false);
    setPanning(false);
    panRef.current = null;
  }, [item]);

  useEffect(() => {
    const element = viewportRef.current;
    if (!item || !element) return;
    const update = () => {
      setViewport({
        width: element.clientWidth || Math.max(320, window.innerWidth - 96),
        height: element.clientHeight || Math.max(240, window.innerHeight - 168),
      });
    };
    update();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [item]);

  const fitScale = useMemo(
    () => screeningViewerFitScale(viewport, imageSize),
    [imageSize, viewport],
  );
  const maxZoom = screeningViewerMaxZoom(fitScale);
  const displaySize = screeningViewerDisplaySize(imageSize, fitScale, zoom);
  const actualZoom = clampScreeningViewerZoom(1 / fitScale, maxZoom);
  const canPan =
    displaySize.width > viewport.width - 64 || displaySize.height > viewport.height - 64;
  const effectivePercent = Math.round(fitScale * zoom * 100);

  useEffect(() => {
    setOffset((current) =>
      clampScreeningViewerOffset(current, viewport, imageSize, fitScale, zoom),
    );
  }, [fitScale, imageSize, viewport, zoom]);

  if (!item) return null;

  function zoomAt(requestedZoom: number, anchor: ViewerPoint = { x: 0, y: 0 }) {
    const next = zoomScreeningViewerAt(
      { zoom, offset },
      requestedZoom,
      anchor,
      viewport,
      imageSize,
      fitScale,
    );
    setZoom(next.zoom);
    setOffset(next.offset);
  }

  function fit() {
    setZoom(1);
    setOffset({ x: 0, y: 0 });
  }

  function actual() {
    setZoom(actualZoom);
    setOffset({ x: 0, y: 0 });
  }

  function handleWheel(event: WheelEvent<HTMLDivElement>) {
    event.preventDefault();
    event.stopPropagation();
    const bounds = event.currentTarget.getBoundingClientRect();
    const anchor = {
      x: event.clientX - bounds.left - bounds.width / 2,
      y: event.clientY - bounds.top - bounds.height / 2,
    };
    zoomAt(zoom * Math.exp(-event.deltaY * 0.0015), anchor);
  }

  function handlePointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || !canPan) return;
    event.preventDefault();
    panRef.current = {
      pointerId: event.pointerId,
      start: { x: event.clientX, y: event.clientY },
      offset,
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setPanning(true);
  }

  function handlePointerMove(event: PointerEvent<HTMLDivElement>) {
    const pan = panRef.current;
    if (!pan || pan.pointerId !== event.pointerId) return;
    setOffset(
      clampScreeningViewerOffset(
        {
          x: pan.offset.x + event.clientX - pan.start.x,
          y: pan.offset.y + event.clientY - pan.start.y,
        },
        viewport,
        imageSize,
        fitScale,
        zoom,
      ),
    );
  }

  function handlePointerEnd(event: PointerEvent<HTMLDivElement>) {
    if (panRef.current?.pointerId !== event.pointerId) return;
    panRef.current = null;
    setPanning(false);
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture?.(event.pointerId);
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === "+" || event.key === "=") {
      event.preventDefault();
      zoomAt(zoom * SCREENING_VIEWER_ZOOM_STEP);
    } else if (event.key === "-") {
      event.preventDefault();
      zoomAt(zoom / SCREENING_VIEWER_ZOOM_STEP);
    } else if (event.key === "0") {
      event.preventDefault();
      fit();
    } else if (event.key === "1") {
      event.preventDefault();
      actual();
    }
  }

  const titleId = `screening-lightbox-title-${item.asset_id}`;
  return (
    <ModalLayer
      open
      onClose={onClose}
      backdropClassName="screening-lightbox-backdrop"
      panelClassName="screening-lightbox"
      labelledBy={titleId}
      initialFocusSelector="[data-screening-lightbox-close]"
    >
      <section className="screening-lightbox__layout" onKeyDown={handleKeyDown}>
        <header className="screening-lightbox__header">
          <div>
            <strong id={titleId}>{itemFilename(item)}</strong>
            <span>
              {imageSize.width} × {imageSize.height} · 滚轮缩放 · 拖动查看 · 双击切换适应/1:1
            </span>
          </div>
          <div className="screening-lightbox__controls">
            <button
              type="button"
              aria-label="缩小大图"
              title="缩小（-）"
              onClick={() => zoomAt(zoom / SCREENING_VIEWER_ZOOM_STEP)}
            >
              <Minus size={17} />
            </button>
            <output aria-label="大图缩放比例">{effectivePercent}%</output>
            <button
              type="button"
              aria-label="放大大图"
              title="放大（+）"
              onClick={() => zoomAt(zoom * SCREENING_VIEWER_ZOOM_STEP)}
            >
              <Plus size={17} />
            </button>
            <button type="button" className="is-text" title="实际像素（1）" onClick={actual}>
              1:1
            </button>
            <button type="button" aria-label="适应窗口" title="适应窗口（0）" onClick={fit}>
              <Maximize2 size={16} />
            </button>
            <button
              type="button"
              data-screening-lightbox-close=""
              aria-label="关闭大图"
              title="关闭（Esc）"
              onClick={onClose}
            >
              <X size={18} />
            </button>
          </div>
        </header>
        <div
          ref={viewportRef}
          className={`screening-lightbox__viewport ${canPan ? "is-pannable" : ""} ${
            panning ? "is-panning" : ""
          }`.trim()}
          aria-label="大图查看区域"
          onWheel={handleWheel}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerEnd}
          onPointerCancel={handlePointerEnd}
          onDoubleClick={() => (Math.abs(zoom - 1) < 0.01 ? actual() : fit())}
        >
          {!loaded && !failed ? (
            <div className="screening-lightbox__loading">
              <Scan size={24} />
              <span>正在载入原图…</span>
            </div>
          ) : null}
          {failed ? (
            <div className="screening-lightbox__loading is-error">
              <span>原图载入失败</span>
            </div>
          ) : null}
          <img
            src={imageUrl(projectId, item.asset_id, operationId)}
            alt={itemFilename(item)}
            draggable={false}
            className={loaded ? "is-loaded" : ""}
            style={{
              width: displaySize.width,
              height: displaySize.height,
              transform: `translate(-50%, -50%) translate(${offset.x}px, ${offset.y}px)`,
            }}
            onLoad={(event) => {
              const width = event.currentTarget.naturalWidth;
              const height = event.currentTarget.naturalHeight;
              if (width > 0 && height > 0) setImageSize({ width, height });
              setLoaded(true);
            }}
            onError={() => setFailed(true)}
          />
          {canPan ? (
            <span className="screening-lightbox__pan-hint">
              <Move size={13} /> 按住左键拖动
            </span>
          ) : null}
        </div>
      </section>
    </ModalLayer>
  );
}
