import { useEffect, useRef, useState, type PointerEvent } from "react";

interface ViewTransform {
  zoom: number;
  x: number;
  y: number;
}
interface PanGesture {
  pointerId: number;
  x: number;
  y: number;
  origin: ViewTransform;
}

function editableTarget(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    Boolean(
      target.closest("input, textarea, select, [contenteditable='true'], [role='dialog'], dialog"),
    )
  );
}

export function useCropViewport() {
  const viewport = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<ViewTransform>({ zoom: 1, x: 0, y: 0 });
  const [spaceHeld, setSpaceHeld] = useState(false);
  const [panning, setPanning] = useState(false);
  const space = useRef(false);
  const hovered = useRef(false);
  const pan = useRef<PanGesture | null>(null);

  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    function wheel(event: WheelEvent) {
      event.preventDefault();
      event.stopPropagation();
      if (pan.current) return;
      const bounds = element!.getBoundingClientRect();
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? element!.clientHeight : 1;
      const delta = event.deltaY * unit;
      const x =
        ((event.clientX - bounds.left - bounds.width / 2) * element!.clientWidth) / bounds.width;
      const y =
        ((event.clientY - bounds.top - bounds.height / 2) * element!.clientHeight) / bounds.height;
      setView((current) => {
        const zoom = Math.max(0.1, Math.min(16, current.zoom * Math.exp(-delta * 0.0015)));
        const factor = zoom / current.zoom;
        return { zoom, x: x - (x - current.x) * factor, y: y - (y - current.y) * factor };
      });
    }
    function keydown(event: KeyboardEvent) {
      if (event.code !== "Space" || editableTarget(event.target)) return;
      if (!hovered.current && !element!.contains(document.activeElement)) return;
      event.preventDefault();
      space.current = true;
      setSpaceHeld(true);
    }
    function releaseSpace() {
      space.current = false;
      setSpaceHeld(false);
    }
    function keyup(event: KeyboardEvent) {
      if (event.code === "Space") releaseSpace();
    }
    function blur() {
      releaseSpace();
      const gesture = pan.current;
      pan.current = null;
      setPanning(false);
      if (gesture && element!.hasPointerCapture(gesture.pointerId))
        element!.releasePointerCapture(gesture.pointerId);
    }
    element.addEventListener("wheel", wheel, { passive: false });
    window.addEventListener("keydown", keydown);
    window.addEventListener("keyup", keyup);
    window.addEventListener("blur", blur);
    return () => {
      element.removeEventListener("wheel", wheel);
      window.removeEventListener("keydown", keydown);
      window.removeEventListener("keyup", keyup);
      window.removeEventListener("blur", blur);
    };
  }, []);

  function start(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) {
      if (event.button === 1) event.preventDefault();
      return;
    }
    event.currentTarget.focus({ preventScroll: true });
    if (!space.current) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    pan.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, origin: view };
    setPanning(true);
  }
  function move(event: PointerEvent<HTMLDivElement>) {
    const gesture = pan.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    const element = event.currentTarget;
    const bounds = element.getBoundingClientRect();
    setView({
      ...gesture.origin,
      x: gesture.origin.x + ((event.clientX - gesture.x) * element.clientWidth) / bounds.width,
      y: gesture.origin.y + ((event.clientY - gesture.y) * element.clientHeight) / bounds.height,
    });
  }
  function stop(event: PointerEvent<HTMLDivElement>) {
    if (pan.current?.pointerId !== event.pointerId) return;
    event.stopPropagation();
    pan.current = null;
    setPanning(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
  }
  function fit() {
    setView({ zoom: 1, x: 0, y: 0 });
  }
  return {
    viewport,
    view,
    spaceHeld,
    panning,
    fit,
    handlers: {
      onPointerDownCapture: start,
      onPointerMoveCapture: move,
      onPointerUpCapture: stop,
      onPointerCancelCapture: stop,
      onLostPointerCapture: stop,
      onPointerEnter: () => {
        hovered.current = true;
      },
      onPointerLeave: () => {
        hovered.current = false;
      },
    },
  };
}
