import { useRef, type KeyboardEvent, type PointerEvent } from "react";

interface PaneResizeHandleProps {
  orientation: "horizontal" | "vertical";
  label: string;
  onResize: (delta: number) => void;
  onReset: () => void;
}

export function PaneResizeHandle({ orientation, label, onResize, onReset }: PaneResizeHandleProps) {
  const dragging = useRef(false);
  const lastCoordinate = useRef(0);

  function coordinate(event: PointerEvent<HTMLDivElement>): number {
    return orientation === "vertical" ? event.clientX : event.clientY;
  }

  function handlePointerDown(event: PointerEvent<HTMLDivElement>) {
    event.preventDefault();
    dragging.current = true;
    lastCoordinate.current = coordinate(event);
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handlePointerMove(event: PointerEvent<HTMLDivElement>) {
    if (!dragging.current) return;
    const nextCoordinate = coordinate(event);
    onResize(nextCoordinate - lastCoordinate.current);
    lastCoordinate.current = nextCoordinate;
  }

  function stopDragging(event: PointerEvent<HTMLDivElement>) {
    dragging.current = false;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const decreaseKey = orientation === "vertical" ? "ArrowLeft" : "ArrowUp";
    const increaseKey = orientation === "vertical" ? "ArrowRight" : "ArrowDown";
    if (event.key !== decreaseKey && event.key !== increaseKey) return;
    event.preventDefault();
    onResize(event.key === decreaseKey ? -12 : 12);
  }

  return (
    <div
      className={`pane-resize-handle pane-resize-handle--${orientation}`}
      role="separator"
      aria-label={label}
      aria-orientation={orientation}
      tabIndex={0}
      title={`${label}（双击恢复默认）`}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={stopDragging}
      onPointerCancel={stopDragging}
      onDoubleClick={onReset}
      onKeyDown={handleKeyDown}
    />
  );
}
