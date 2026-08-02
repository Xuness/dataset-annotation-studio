import { useLayoutEffect, type RefObject } from "react";

const CANVAS_WIDTH = 1920;
const CANVAS_HEIGHT = 1080;
const WINDOW_CONTROL_SCREEN_WIDTH = 44;
const WINDOW_ICON_SCREEN_SIZE = 14;
const WINDOW_ICON_SCREEN_STROKE = 1.5;

function referenceLength(screenPixels: number, scale: number): string {
  return `${(screenPixels / scale).toFixed(3)}px`;
}

export function useCanvasScale(
  rootRef: RefObject<HTMLElement | null>,
  canvasRef: RefObject<HTMLElement | null>,
): void {
  useLayoutEffect(() => {
    const root = rootRef.current;
    const canvas = canvasRef.current;
    if (!root || !canvas) return;

    const update = () => {
      const bounds = root.getBoundingClientRect();
      const width = bounds.width || window.innerWidth;
      const height = bounds.height || window.innerHeight;
      const scale = Math.max(0.01, Math.min(width / CANVAS_WIDTH, height / CANVAS_HEIGHT));
      canvas.style.setProperty("--dial-archive-canvas-scale", scale.toFixed(6));
      canvas.style.setProperty(
        "--dial-archive-window-control-width",
        referenceLength(WINDOW_CONTROL_SCREEN_WIDTH, scale),
      );
      canvas.style.setProperty(
        "--dial-archive-window-icon-size",
        referenceLength(WINDOW_ICON_SCREEN_SIZE, scale),
      );
      canvas.style.setProperty(
        "--dial-archive-window-icon-stroke",
        referenceLength(WINDOW_ICON_SCREEN_STROKE, scale),
      );
    };

    update();
    window.addEventListener("resize", update);
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(update) : undefined;
    observer?.observe(root);

    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [canvasRef, rootRef]);
}
