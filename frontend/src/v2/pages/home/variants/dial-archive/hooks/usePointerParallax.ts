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

export function usePointerParallax(
  rootRef: RefObject<HTMLElement | null>,
  reducedMotion: boolean,
): void {
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const reset = () => {
      root.style.setProperty("--dial-archive-ghost-x", "0px");
      root.style.setProperty("--dial-archive-ghost-y", "0px");
      root.style.setProperty("--dial-archive-dial-x", "0px");
      root.style.setProperty("--dial-archive-dial-y", "0px");
      root.style.setProperty("--dial-archive-dial-rx", "0deg");
      root.style.setProperty("--dial-archive-dial-ry", "0deg");
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
      currentX += (targetX - currentX) * 0.105;
      currentY += (targetY - currentY) * 0.105;
      root.style.setProperty("--dial-archive-ghost-x", `${(currentX * 5).toFixed(3)}px`);
      root.style.setProperty("--dial-archive-ghost-y", `${(currentY * 5).toFixed(3)}px`);
      root.style.setProperty("--dial-archive-dial-x", `${(currentX * 3).toFixed(3)}px`);
      root.style.setProperty("--dial-archive-dial-y", `${(currentY * 3).toFixed(3)}px`);
      root.style.setProperty("--dial-archive-dial-rx", `${(-currentY * 0.42).toFixed(3)}deg`);
      root.style.setProperty("--dial-archive-dial-ry", `${(currentX * 0.52).toFixed(3)}deg`);

      if (Math.abs(targetX - currentX) > 0.002 || Math.abs(targetY - currentY) > 0.002) {
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
      const left = bounds.width ? bounds.left : 0;
      const top = bounds.height ? bounds.top : 0;
      targetX = ((event.clientX - left) / width - 0.5) * 2;
      targetY = ((event.clientY - top) / height - 0.5) * 2;
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
