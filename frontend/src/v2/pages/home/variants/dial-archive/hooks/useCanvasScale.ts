import { useLayoutEffect, type RefObject } from "react";

const CANVAS_WIDTH = 1920;
const CANVAS_HEIGHT = 1080;

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
