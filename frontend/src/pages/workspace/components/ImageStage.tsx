import { useEffect, useState } from "react";
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

  useEffect(() => {
    setZoom(1);
    setLoaded(false);
  }, [asset?.id]);

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
          <button onClick={() => setZoom((value) => Math.max(0.25, value - 0.15))} title="缩小">
            <Minus size={14} />
          </button>
          <span>{Math.round(zoom * 100)}%</span>
          <button onClick={() => setZoom((value) => Math.min(3, value + 0.15))} title="放大">
            <Plus size={14} />
          </button>
          <button onClick={() => setZoom(1)} title="适应窗口">
            <Maximize2 size={14} />
          </button>
        </div>
      </header>
      <div className={`image-stage__canvas ${loaded ? "is-loaded" : ""}`}>
        <div className="image-stage__checker" />
        <img
          src={imageUrl(projectId, asset.id)}
          alt={asset.filename}
          style={{ transform: `scale(${zoom})` }}
          onLoad={() => setLoaded(true)}
        />
      </div>
    </section>
  );
}
