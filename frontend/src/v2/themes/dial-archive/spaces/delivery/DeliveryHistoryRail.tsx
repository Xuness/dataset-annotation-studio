import { useEffect, useRef, type PointerEvent as ReactPointerEvent } from "react";

import type { DeliveryOperationSummary } from "../../../../pages/spaces/spacePageModel";
import { formatDeliveryBytes, formatDeliveryDate } from "./model/deliveryPresentation";

interface DeliveryHistoryRailProps {
  operations: readonly DeliveryOperationSummary[];
  selectedOperationId?: string | null;
  onSelect(operationId: string): void;
  onCreate(): void;
  compact?: boolean;
}

interface DragState {
  pointerId: number;
  startX: number;
  startScrollLeft: number;
  moved: boolean;
}

export function DeliveryHistoryRail({
  operations,
  selectedOperationId = null,
  onSelect,
  onCreate,
  compact = false,
}: DeliveryHistoryRailProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const suppressClickRef = useRef(false);

  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    const handleWheel = (event: WheelEvent) => {
      if (track.scrollWidth <= track.clientWidth) return;
      const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
      const next = Math.max(
        0,
        Math.min(track.scrollWidth - track.clientWidth, track.scrollLeft + delta),
      );
      if (next === track.scrollLeft) return;
      event.preventDefault();
      track.scrollLeft = next;
    };
    track.addEventListener("wheel", handleWheel, { passive: false });
    return () => track.removeEventListener("wheel", handleWheel);
  }, []);

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const track = trackRef.current;
    if (!track) return;
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startScrollLeft: track.scrollLeft,
      moved: false,
    };
    track.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const track = trackRef.current;
    const drag = dragRef.current;
    if (!track || !drag || drag.pointerId !== event.pointerId) return;
    const distance = event.clientX - drag.startX;
    if (Math.abs(distance) > 4) drag.moved = true;
    if (drag.moved) track.scrollLeft = drag.startScrollLeft - distance;
  };

  const finishDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const track = trackRef.current;
    const drag = dragRef.current;
    if (!track || !drag || drag.pointerId !== event.pointerId) return;
    suppressClickRef.current = drag.moved;
    dragRef.current = null;
    if (track.hasPointerCapture(event.pointerId)) track.releasePointerCapture(event.pointerId);
  };

  return (
    <section
      className={`dial-archive-delivery-history${compact ? " is-compact" : ""}`}
      aria-labelledby="delivery-history-title"
    >
      <header>
        <span>DELIVERY LOG //</span>
        <h2 id="delivery-history-title">出站记录</h2>
        <p>拖动或使用滚轮浏览当前项目的交付操作。</p>
        <button type="button" onClick={onCreate}>
          <b>新建方案</b>
          <span>+ SPEC</span>
        </button>
      </header>
      <div
        className="dial-archive-delivery-history__track"
        ref={trackRef}
        role="region"
        aria-label="可滚动交付记录"
        tabIndex={0}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={finishDrag}
        onPointerCancel={finishDrag}
        onClickCapture={(event) => {
          if (!suppressClickRef.current) return;
          event.preventDefault();
          event.stopPropagation();
          suppressClickRef.current = false;
        }}
      >
        <div className="dial-archive-delivery-history__axis" aria-hidden="true" />
        {operations.map((operation, index) => (
          <button
            className={`dial-archive-delivery-history__record is-${operation.tone}${
              selectedOperationId === operation.id ? " is-selected" : ""
            }`}
            type="button"
            aria-label={`打开交付记录 ${operation.shortId}`}
            onClick={() => onSelect(operation.id)}
            key={operation.id}
          >
            <span className="dial-archive-delivery-history__stamp">
              <em>{String(operations.length - index).padStart(2, "0")}</em>
              <b>{formatDeliveryDate(operation.createdAt)}</b>
            </span>
            <span className="dial-archive-delivery-history__body">
              <strong>{operation.statusLabel}</strong>
              <small>
                {operation.manifest.packagingLabel} · {operation.manifest.formatLabel}
              </small>
              <small>
                {operation.manifest.selections.map((selection) => selection.label).join(" · ") ||
                  "无通道"}
              </small>
            </span>
            <span className="dial-archive-delivery-history__metrics">
              <b>{operation.totalItems}</b>
              <small>{formatDeliveryBytes(operation.totalBytes)}</small>
            </span>
          </button>
        ))}
        {!operations.length ? (
          <div className="dial-archive-delivery-history__empty">
            <span>00</span>
            <b>还没有交付记录</b>
            <small>第一份完成的 Manifest 会沿这条轨道留下操作封签。</small>
          </div>
        ) : null}
      </div>
    </section>
  );
}
