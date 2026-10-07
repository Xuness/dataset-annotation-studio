import { useRef, useState, type PointerEvent } from "react";

import { Maximize2 } from "lucide-react";
import { Button } from "../../shared/ui/Button";

import { imageViewportLayout } from "../../../src/application/cropping/imageViewportLayout";
import { useCropViewport } from "../../../src/application/cropping/useCropViewport";
import { drawnRect } from "../../../src/application/cropping/geometry";
import { imageUrl } from "../../../src/features/assets/api";
import type { CropSource, CropRect, Ratio } from "../../../src/shared/api/types";

interface Props {
  projectId: string;
  asset: CropSource;
  interaction: "regions" | "position";
  rectangles: CropRect[];
  selected: number;
  ratio: Ratio | null;
  disabled: boolean;
  onSelect: (index: number) => void;
  onChange: (rectangles: CropRect[]) => void;
}
interface Drag {
  pointerId: number;
  x: number;
  y: number;
  index: number;
  kind: "draw" | "move" | "resize";
  original: CropRect | null;
  baseline: CropRect[];
}
export function CropCanvas({
  projectId,
  asset,
  interaction,
  rectangles,
  selected,
  ratio,
  disabled,
  onSelect,
  onChange,
}: Props) {
  const { viewport, view, spaceHeld, panning, fit, handlers } = useCropViewport();
  const zoom = view.zoom;
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<Drag | null>(null);
  const [error, setError] = useState<string | null>(null);
  function point(event: PointerEvent<SVGSVGElement>): { x: number; y: number } {
    const bounds = svg.current!.getBoundingClientRect();
    return {
      x: Math.round(((event.clientX - bounds.left) * asset.width) / bounds.width),
      y: Math.round(((event.clientY - bounds.top) * asset.height) / bounds.height),
    };
  }
  function start(event: PointerEvent<SVGSVGElement>) {
    if (disabled || event.button !== 0) return;
    event.preventDefault();
    svg.current!.setPointerCapture(event.pointerId);
    const p = point(event);
    const target = event.target as SVGElement;
    const index = interaction === "position" ? 0 : Number(target.dataset.index ?? -1);
    if (index >= 0) onSelect(index);
    const kind =
      interaction === "position"
        ? "move"
        : target.dataset.handle
          ? "resize"
          : index >= 0
            ? "move"
            : "draw";
    drag.current = {
      pointerId: event.pointerId,
      ...p,
      index,
      kind,
      original: index >= 0 ? rectangles[index] : null,
      baseline: rectangles,
    };
  }
  function move(event: PointerEvent<SVGSVGElement>) {
    const active = drag.current;
    if (!active || active.pointerId !== event.pointerId) return;
    const p = point(event);
    try {
      let rect: CropRect;
      if (active.kind === "move" && active.original) {
        const original = active.original;
        rect = {
          ...original,
          x: Math.max(0, Math.min(asset.width - original.width, original.x + p.x - active.x)),
          y: Math.max(0, Math.min(asset.height - original.height, original.y + p.y - active.y)),
        };
      } else if (active.kind === "resize" && active.original) {
        const original = active.original;
        rect = drawnRect(
          original.x,
          original.y,
          p.x,
          p.y,
          asset.width,
          asset.height,
          original.ratio,
        );
      } else {
        rect = drawnRect(active.x, active.y, p.x, p.y, asset.width, asset.height, ratio);
      }
      const index = active.index < 0 ? active.baseline.length : active.index;
      onChange(
        active.index < 0
          ? [...active.baseline, rect]
          : active.baseline.map((item, i) => (i === index ? rect : item)),
      );
      onSelect(index);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }
  function stop(event: PointerEvent<SVGSVGElement>) {
    drag.current = null;
    if (svg.current?.hasPointerCapture(event.pointerId))
      svg.current.releasePointerCapture(event.pointerId);
  }
  const fitWidth = viewport.current
    ? Math.min(
        viewport.current.clientWidth,
        (viewport.current.clientHeight * asset.width) / asset.height,
      )
    : asset.width;
  const handleSize = Math.max(1, (asset.width / (fitWidth || asset.width) / zoom) * 12);
  const orderedRectangles = rectangles
    .map((rect, index) => ({ rect, index }))
    .sort((left, right) => Number(left.index === selected) - Number(right.index === selected));
  return (
    <section className="crop-canvas-section">
      <div className="crop-canvas-tools">
        <span
          className="crop-zoom-level"
          data-testid="crop-zoom-level"
          title="相对于适应窗口的缩放比例"
        >
          {Math.round(zoom * 100)}%
        </span>
        <Button icon={<Maximize2 size={14} />} data-testid="crop-fit" onClick={fit}>
          适应窗口
        </Button>
      </div>
      <div
        className={`crop-canvas-viewport${spaceHeld ? " is-space-held" : ""}${panning ? " is-panning" : ""}`}
        ref={viewport}
        data-testid="crop-canvas-viewport"
        tabIndex={0}
        aria-label="裁剪画布，滚轮缩放，空格加左键自由拖动图片"
        {...handlers}
      >
        <div
          className="crop-canvas-image"
          style={imageViewportLayout(asset.width, asset.height, view)}
        >
          <img
            src={imageUrl(projectId, asset.id, asset.content_version)}
            alt={asset.filename}
            draggable={false}
          />
          <svg
            ref={svg}
            data-testid="crop-canvas"
            viewBox={`0 0 ${asset.width} ${asset.height}`}
            onPointerDown={start}
            onPointerMove={move}
            onPointerUp={stop}
            onPointerCancel={stop}
            onLostPointerCapture={() => {
              drag.current = null;
            }}
            aria-label="图片裁剪画布"
          >
            {orderedRectangles.map(({ rect, index }) => (
              <g key={index}>
                <rect
                  data-testid={`crop-frame-${index}`}
                  data-index={index}
                  x={rect.x}
                  y={rect.y}
                  width={rect.width}
                  height={rect.height}
                  className={index === selected ? "crop-frame is-selected" : "crop-frame"}
                />
                <text
                  x={rect.x + handleSize / 3}
                  y={rect.y + handleSize * 1.5}
                  fontSize={handleSize * 1.2}
                  pointerEvents="none"
                >
                  {index + 1}
                </text>
                {interaction === "regions" && (
                  <rect
                    data-testid={`crop-handle-${index}`}
                    data-index={index}
                    data-handle="resize"
                    x={rect.x + rect.width - handleSize}
                    y={rect.y + rect.height - handleSize}
                    width={handleSize}
                    height={handleSize}
                    className="crop-handle"
                  />
                )}
              </g>
            ))}
          </svg>
        </div>
      </div>
      <p className="crop-canvas-help">
        {interaction === "position"
          ? "直接拖动调整位置 · 固定最大尺寸与统一比例"
          : "拖动框选 · 拖框移动 · 右下角缩放"}{" "}
        · 滚轮缩放 · 空格 + 左键自由拖动图片
      </p>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
