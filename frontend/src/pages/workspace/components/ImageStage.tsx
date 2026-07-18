import { useEffect, useMemo, useRef, useState, type PointerEvent, type WheelEvent } from "react";
import { ImageIcon, Maximize2, Minus, Plus } from "lucide-react";

import { imageUrl } from "../../../features/assets/api";
import type { AssetSummary } from "../../../shared/api/types";

interface ImageStageProps {
  projectId: string;
  asset: AssetSummary | null;
}

const MIN_ZOOM = 0.25;

export function ImageStage({ projectId, asset }: ImageStageProps) {
  const [zoom, setZoom] = useState(1);
  const [loaded, setLoaded] = useState(false);
  const [panning, setPanning] = useState(false);
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const canvasRef = useRef<HTMLDivElement>(null);
  const panRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    left: number;
    top: number;
  } | null>(null);

  useEffect(() => {
    setZoom(1);
    setLoaded(false);
  }, [asset?.content_version, asset?.id]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const measure = () => {
      setViewport({ width: canvas.clientWidth, height: canvas.clientHeight });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [asset?.content_version, asset?.id]);

  const fitScale = useMemo(() => {
    if (!asset || viewport.width === 0 || viewport.height === 0) return null;
    const availableWidth = Math.max(1, viewport.width - 36);
    const availableHeight = Math.max(1, viewport.height - 36);
    return Math.min(1, availableWidth / asset.width, availableHeight / asset.height);
  }, [asset, viewport]);

  const displaySize = useMemo(() => {
    if (!asset || fitScale === null) return null;
    return {
      width: Math.max(1, Math.round(asset.width * fitScale * zoom)),
      height: Math.max(1, Math.round(asset.height * fitScale * zoom)),
    };
  }, [asset, fitScale, zoom]);

  // 保证任何尺寸的图片都能放大到实际像素
  const maxZoom = useMemo(
    () => (fitScale ? Math.min(12, Math.max(3, 1 / fitScale)) : 3),
    [fitScale],
  );

  const canPan = Boolean(
    displaySize &&
    viewport.width > 0 &&
    (displaySize.width + 36 > viewport.width || displaySize.height + 36 > viewport.height),
  );

  function clampZoom(value: number) {
    return Math.min(maxZoom, Math.max(MIN_ZOOM, value));
  }

  function changeZoom(delta: number) {
    setZoom((value) => clampZoom(value + delta));
  }

  function zoomToActual() {
    if (!fitScale) return;
    setZoom(clampZoom(1 / fitScale));
  }

  function toggleFitOrActual() {
    if (!fitScale) return;
    setZoom((value) => (Math.abs(value - 1) < 0.01 ? clampZoom(1 / fitScale) : 1));
  }

  function handleWheel(event: WheelEvent<HTMLDivElement>) {
    if (!event.ctrlKey) return;
    event.preventDefault();
    changeZoom(event.deltaY < 0 ? 0.15 : -0.15);
  }

  function handlePanStart(event: PointerEvent<HTMLDivElement>) {
    const canvas = canvasRef.current;
    if (event.button !== 0 || !canPan || !canvas) return;
    panRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      left: canvas.scrollLeft,
      top: canvas.scrollTop,
    };
    canvas.setPointerCapture(event.pointerId);
    setPanning(true);
  }

  function handlePanMove(event: PointerEvent<HTMLDivElement>) {
    const pan = panRef.current;
    const canvas = canvasRef.current;
    if (!pan || !canvas || pan.pointerId !== event.pointerId) return;
    canvas.scrollLeft = pan.left - (event.clientX - pan.startX);
    canvas.scrollTop = pan.top - (event.clientY - pan.startY);
  }

  function handlePanEnd(event: PointerEvent<HTMLDivElement>) {
    const pan = panRef.current;
    if (!pan || pan.pointerId !== event.pointerId) return;
    panRef.current = null;
    setPanning(false);
    if (canvasRef.current?.hasPointerCapture(event.pointerId)) {
      canvasRef.current.releasePointerCapture(event.pointerId);
    }
  }

  if (!asset) {
    return (
      <section className="image-stage image-stage--empty">
        <ImageIcon size={34} />
        <p>从左侧选择一张图片</p>
      </section>
    );
  }

  const effectivePercent = fitScale ? Math.round(fitScale * zoom * 100) : 100;
  const canvasClass = [
    "image-stage__canvas",
    loaded && displaySize ? "is-loaded" : "",
    canPan ? "is-pannable" : "",
    panning ? "is-panning" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <section className="image-stage">
      <header className="image-stage__header">
        <div>
          <strong>{asset.filename}</strong>
          <span>
            {asset.width} × {asset.height} · {asset.suffix.slice(1).toUpperCase()}
          </span>
        </div>
        <div className="zoom-controls">
          <button onClick={() => changeZoom(-0.15)} title="缩小">
            <Minus size={14} />
          </button>
          <span title="相对于实际像素的显示比例">{effectivePercent}%</span>
          <button onClick={() => changeZoom(0.15)} title="放大">
            <Plus size={14} />
          </button>
          <button
            className="zoom-controls__actual"
            onClick={zoomToActual}
            title="实际像素（双击画布可在适应窗口与实际像素间切换）"
          >
            1:1
          </button>
          <button onClick={() => setZoom(1)} title="适应窗口（Ctrl + 滚轮缩放）">
            <Maximize2 size={14} />
          </button>
        </div>
      </header>
      <div
        ref={canvasRef}
        className={canvasClass}
        onWheel={handleWheel}
        onPointerDown={handlePanStart}
        onPointerMove={handlePanMove}
        onPointerUp={handlePanEnd}
        onPointerCancel={handlePanEnd}
        onDoubleClick={toggleFitOrActual}
      >
        <div className="image-stage__checker" />
        <div className="image-stage__scroll-content">
          <img
            src={imageUrl(projectId, asset.id, asset.content_version)}
            alt={asset.filename}
            style={displaySize ?? undefined}
            onLoad={() => setLoaded(true)}
            draggable={false}
          />
        </div>
      </div>
    </section>
  );
}
