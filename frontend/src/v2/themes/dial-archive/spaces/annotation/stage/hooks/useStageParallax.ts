import { useEffect, type RefObject } from "react";

function requestFrame(callback: FrameRequestCallback): number {
  return typeof window.requestAnimationFrame === "function"
    ? window.requestAnimationFrame(callback)
    : window.setTimeout(() => callback(performance.now()), 16);
}

function cancelFrame(frame: number): void {
  if (typeof window.cancelAnimationFrame === "function") window.cancelAnimationFrame(frame);
  else window.clearTimeout(frame);
}

/**
 * 施工场指针视差：把指针位置写入根节点 CSS 变量，星尘层、地面与
 * 幽灵字按各自系数消费，制造多层景深。rAF 驱动，不进 React state。
 */
export function useStageParallax(
  rootRef: RefObject<HTMLElement | null>,
  reducedMotion: boolean,
): void {
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const reset = () => {
      root.style.setProperty("--dial-archive-stage-px", "0");
      root.style.setProperty("--dial-archive-stage-py", "0");
    };

    if (reducedMotion) {
      reset();
      return;
    }

    let targetX = 0;
    let targetY = 0;
    let currentX = 0;
    let currentY = 0;
    let frame = 0;

    const paint = () => {
      currentX += (targetX - currentX) * 0.08;
      currentY += (targetY - currentY) * 0.08;
      root.style.setProperty("--dial-archive-stage-px", currentX.toFixed(4));
      root.style.setProperty("--dial-archive-stage-py", currentY.toFixed(4));
      if (Math.abs(targetX - currentX) > 0.001 || Math.abs(targetY - currentY) > 0.001) {
        frame = requestFrame(paint);
      } else {
        frame = 0;
      }
    };

    const start = () => {
      if (!frame) frame = requestFrame(paint);
    };
    const handlePointerMove = (event: PointerEvent) => {
      const bounds = root.getBoundingClientRect();
      const width = bounds.width || window.innerWidth;
      const height = bounds.height || window.innerHeight;
      targetX = ((event.clientX - bounds.left) / width - 0.5) * 2;
      targetY = ((event.clientY - bounds.top) / height - 0.5) * 2;
      start();
    };
    const handlePointerLeave = () => {
      targetX = 0;
      targetY = 0;
      start();
    };

    root.addEventListener("pointermove", handlePointerMove);
    root.addEventListener("pointerleave", handlePointerLeave);
    window.addEventListener("blur", handlePointerLeave);
    return () => {
      if (frame) cancelFrame(frame);
      root.removeEventListener("pointermove", handlePointerMove);
      root.removeEventListener("pointerleave", handlePointerLeave);
      window.removeEventListener("blur", handlePointerLeave);
      reset();
    };
  }, [reducedMotion, rootRef]);
}
