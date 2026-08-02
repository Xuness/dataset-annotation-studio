import { useCallback, useLayoutEffect, useRef, type RefObject } from "react";

import {
  DIAL_CENTER,
  DIAL_INNER_RATIO,
  DIAL_NUMBER_REST_ANGLES,
  dialNumberPoint,
  dialRotationForIndex,
} from "../model/dialGeometry";
import {
  formatDialDegrees,
  INNER_DIAL_SPRING,
  integrateSpring,
  OUTER_DIAL_SPRING,
  springIsSettled,
  type SpringState,
} from "../model/dialMotion";

interface DialEngineState {
  outer: SpringState;
  inner: SpringState;
}

export interface DialMotionBindings {
  initialRotation: number;
  initialInnerRotation: number;
  outerRotorRef: RefObject<SVGGElement | null>;
  innerRotorRef: RefObject<SVGGElement | null>;
  rotationReadoutRef: RefObject<HTMLSpanElement | null>;
  velocityReadoutRef: RefObject<HTMLSpanElement | null>;
  velocityBarRef: RefObject<HTMLSpanElement | null>;
  motionStateRef: RefObject<HTMLSpanElement | null>;
  setNumberRef(index: number, node: SVGTextElement | null): void;
}

function requestFrame(callback: FrameRequestCallback): number {
  return typeof window.requestAnimationFrame === "function"
    ? window.requestAnimationFrame(callback)
    : window.setTimeout(() => callback(performance.now()), 16);
}

function cancelFrame(frame: number): void {
  if (typeof window.cancelAnimationFrame === "function") window.cancelAnimationFrame(frame);
  else window.clearTimeout(frame);
}

export function useDialMotion(targetIndex: number, reducedMotion: boolean): DialMotionBindings {
  const initialRotationRef = useRef(dialRotationForIndex(targetIndex));
  const outerRotorRef = useRef<SVGGElement>(null);
  const innerRotorRef = useRef<SVGGElement>(null);
  const numberRefs = useRef<Array<SVGTextElement | null>>([]);
  const rotationReadoutRef = useRef<HTMLSpanElement>(null);
  const velocityReadoutRef = useRef<HTMLSpanElement>(null);
  const velocityBarRef = useRef<HTMLSpanElement>(null);
  const motionStateRef = useRef<HTMLSpanElement>(null);
  const engineRef = useRef<DialEngineState>({
    outer: { position: initialRotationRef.current, velocity: 0 },
    inner: { position: DIAL_INNER_RATIO * initialRotationRef.current, velocity: 0 },
  });

  const setNumberRef = useCallback((index: number, node: SVGTextElement | null) => {
    numberRefs.current[index] = node;
  }, []);

  useLayoutEffect(() => {
    const target = dialRotationForIndex(targetIndex);
    const engine = engineRef.current;
    let frame = 0;
    let active = true;
    let last = performance.now();

    const render = () => {
      outerRotorRef.current?.setAttribute(
        "transform",
        `rotate(${engine.outer.position} ${DIAL_CENTER} ${DIAL_CENTER})`,
      );
      innerRotorRef.current?.setAttribute(
        "transform",
        `rotate(${engine.inner.position} ${DIAL_CENTER} ${DIAL_CENTER})`,
      );
      DIAL_NUMBER_REST_ANGLES.forEach((_, index) => {
        const number = numberRefs.current[index];
        if (!number) return;
        const [x, y] = dialNumberPoint(index, engine.outer.position);
        number.setAttribute("x", String(x));
        number.setAttribute("y", String(y));
      });

      const velocity = Math.abs(engine.outer.velocity);
      if (rotationReadoutRef.current) {
        rotationReadoutRef.current.textContent = formatDialDegrees(engine.outer.position);
      }
      if (velocityReadoutRef.current) {
        velocityReadoutRef.current.textContent = `${String(Math.round(velocity)).padStart(3, "0")}°/s`;
      }
      if (velocityBarRef.current) {
        const percentage = Math.min((velocity / OUTER_DIAL_SPRING.maximumVelocity) * 100, 100);
        velocityBarRef.current.style.width = `${percentage.toFixed(1)}%`;
      }
      if (motionStateRef.current) {
        motionStateRef.current.textContent = velocity > 1 ? "MOV" : "LOCK";
      }
    };

    if (reducedMotion) {
      engine.outer.position = target;
      engine.outer.velocity = 0;
      engine.inner.position = DIAL_INNER_RATIO * target;
      engine.inner.velocity = 0;
      render();
      return;
    }

    const tick = (now: number) => {
      if (!active) return;
      const elapsed = Math.min(Math.max((now - last) / 1000, 0), 0.04);
      last = now;
      integrateSpring(engine.outer, target, elapsed, OUTER_DIAL_SPRING);
      integrateSpring(
        engine.inner,
        DIAL_INNER_RATIO * engine.outer.position,
        elapsed,
        INNER_DIAL_SPRING,
      );
      render();

      const moving =
        !springIsSettled(engine.outer, target) ||
        !springIsSettled(engine.inner, DIAL_INNER_RATIO * target);
      if (moving) {
        frame = requestFrame(tick);
        return;
      }

      engine.outer.position = target;
      engine.outer.velocity = 0;
      engine.inner.position = DIAL_INNER_RATIO * target;
      engine.inner.velocity = 0;
      render();
      frame = 0;
    };

    render();
    const alreadySettled =
      springIsSettled(engine.outer, target) &&
      springIsSettled(engine.inner, DIAL_INNER_RATIO * target);
    if (!alreadySettled) frame = requestFrame(tick);

    return () => {
      active = false;
      if (frame) cancelFrame(frame);
    };
  }, [reducedMotion, targetIndex]);

  return {
    initialRotation: initialRotationRef.current,
    initialInnerRotation: DIAL_INNER_RATIO * initialRotationRef.current,
    outerRotorRef,
    innerRotorRef,
    rotationReadoutRef,
    velocityReadoutRef,
    velocityBarRef,
    motionStateRef,
    setNumberRef,
  };
}
