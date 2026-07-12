import { useEffect, useMemo, useRef, useState, type WheelEvent } from "react";
import { ImageIcon, Maximize2, Minus, Plus } from "lucide-react";

import { imageUrl } from "../../../features/assets/api";
import type { AssetSummary } from "../../../shared/api/types";

interface ImageStageProps {
  projectId: string;
  asset: AssetSummary | null;
}

export function ImageStage({ projectId, asset }: ImageStageProps) {
  const [zoom, setZoom] = useState(1);
  const [loaded, setLoaded] = useState(false);
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const canvasRef = useRef<HTMLDivElement>(null);

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

  const displaySize = useMemo(() => {
    if (!asset || viewport.width === 0 || viewport.height === 0) return null;
    const availableWidth = Math.max(1, viewport.width - 36);
    const availableHeight = Math.max(1, viewport.height - 36);
    const fitScale = Math.min(1, availableWidth / asset.width, availableHeight / asset.height);
    return {
      width: Math.max(1, Math.round(asset.width * fitScale * zoom)),
      height: Math.max(1, Math.round(asset.height * fitScale * zoom)),
    };
  }, [asset, viewport, zoom]);

  function changeZoom(delta: number) {
    setZoom((value) => Math.min(3, Math.max(0.25, value + delta)));
  }

  function handleWheel(event: WheelEvent<HTMLDivElement>) {
    if (!event.ctrlKey) return;
    event.preventDefault();
    changeZoom(event.deltaY < 0 ? 0.15 : -0.15);
  }

  if (!asset) {
    return (
      <section className="image-stage image-stage--empty">
        <ImageIcon size={34} />
        <p>从左侧选择一张图片</p>
      </section>
    );
  }

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
          <span>{Math.round(zoom * 100)}%</span>
          <button onClick={() => changeZoom(0.15)} title="放大">
            <Plus size={14} />
          </button>
          <button onClick={() => setZoom(1)} title="适应窗口（Ctrl + 滚轮缩放）">
            <Maximize2 size={14} />
          </button>
        </div>
      </header>
      <div
        ref={canvasRef}
        className={`image-stage__canvas ${loaded && displaySize ? "is-loaded" : ""}`}
        onWheel={handleWheel}
      >
        <div className="image-stage__checker" />
        <div className="image-stage__scroll-content">
          <img
            src={imageUrl(projectId, asset.id, asset.content_version)}
            alt={asset.filename}
            style={displaySize ?? undefined}
            onLoad={() => setLoaded(true)}
          />
        </div>
      </div>
    </section>
  );
}
