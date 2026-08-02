import { useCallback, useLayoutEffect, useRef, type RefObject } from "react";

import {
  DIAL_CENTER,
  DIAL_INNER_RATIO,
  DIAL_NUMBER_REST_ANGLES,
  dialNumberPoint,
  dialRotationForIndex,
} from "../model/dialGeometry";
import {
  dampedValue,
  formatDialDegrees,
  IDLE_FRAME_DEGREES_PER_SECOND,
  IDLE_INNER_DEGREES_PER_SECOND,
  INNER_DIAL_SPRING,
  integrateSpring,
  nearestEquivalentAngle,
  normalizeDegrees,
  OUTER_DIAL_SPRING,
  springIsSettled,
  type SpringState,
} from "../model/dialMotion";

type DialMotionMode = "idle" | "interactive" | "paused";

interface DialEngineState {
  outer: SpringState;
  inner: SpringState;
  ambientFrame: SpringState;
  mode: DialMotionMode;
  target: number;
}

export interface DialMotionBindings {
  initialRotation: number;
  initialInnerRotation: number;
  initialAmbientRotation: number;
  outerRotorRef: RefObject<SVGGElement | null>;
  innerRotorRef: RefObject<SVGGElement | null>;
  ambientRotorRef: RefObject<SVGGElement | null>;
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

export function useDialMotion(
  targetIndex: number,
  reducedMotion: boolean,
  interactionActive: boolean,
): DialMotionBindings {
  const initialRotationRef = useRef(dialRotationForIndex(targetIndex));
  const outerRotorRef = useRef<SVGGElement>(null);
  const innerRotorRef = useRef<SVGGElement>(null);
  const ambientRotorRef = useRef<SVGGElement>(null);
  const numberRefs = useRef<Array<SVGTextElement | null>>([]);
  const rotationReadoutRef = useRef<HTMLSpanElement>(null);
  const velocityReadoutRef = useRef<HTMLSpanElement>(null);
  const velocityBarRef = useRef<HTMLSpanElement>(null);
  const motionStateRef = useRef<HTMLSpanElement>(null);
  const engineRef = useRef<DialEngineState>({
    outer: { position: initialRotationRef.current, velocity: 0 },
    inner: { position: DIAL_INNER_RATIO * initialRotationRef.current, velocity: 0 },
    ambientFrame: { position: 0, velocity: 0 },
    mode: "idle",
    target: initialRotationRef.current,
  });

  const setNumberRef = useCallback((index: number, node: SVGTextElement | null) => {
    numberRefs.current[index] = node;
  }, []);

  useLayoutEffect(() => {
    const target = dialRotationForIndex(targetIndex);
    const engine = engineRef.current;
    const targetChanged = target !== engine.target;
    engine.target = target;
    if (interactionActive || targetChanged) engine.mode = "interactive";
    else if (engine.mode === "paused") engine.mode = "idle";
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
      ambientRotorRef.current?.setAttribute(
        "transform",
        `rotate(${engine.ambientFrame.position} ${DIAL_CENTER} ${DIAL_CENTER})`,
      );
      DIAL_NUMBER_REST_ANGLES.forEach((_, index) => {
        const number = numberRefs.current[index];
        if (!number) return;
        const [x, y] = dialNumberPoint(index, engine.outer.position);
        number.setAttribute("x", String(x));
        number.setAttribute("y", String(y));
      });

      const idle = engine.mode === "idle";
      const velocity = idle
        ? Math.max(Math.abs(engine.ambientFrame.velocity), Math.abs(engine.inner.velocity))
        : Math.abs(engine.outer.velocity);
      const displayedRotation = idle
        ? normalizeDegrees(engine.ambientFrame.position)
        : engine.outer.position;
      if (rotationReadoutRef.current) {
        rotationReadoutRef.current.textContent = formatDialDegrees(displayedRotation);
      }
      if (velocityReadoutRef.current) {
        velocityReadoutRef.current.textContent = `${String(Math.round(velocity)).padStart(3, "0")}°/s`;
      }
      if (velocityBarRef.current) {
        const percentage = Math.min((velocity / OUTER_DIAL_SPRING.maximumVelocity) * 100, 100);
        velocityBarRef.current.style.width = `${percentage.toFixed(1)}%`;
      }
      if (motionStateRef.current) {
        motionStateRef.current.textContent = idle ? "IDLE" : velocity > 1 ? "MOV" : "LOCK";
      }
    };

    if (reducedMotion) {
      engine.outer.position = target;
      engine.outer.velocity = 0;
      engine.inner.position = DIAL_INNER_RATIO * target;
      engine.inner.velocity = 0;
      engine.ambientFrame.position = 0;
      engine.ambientFrame.velocity = 0;
      engine.mode = "paused";
      render();
      return;
    }

    const tick = (now: number) => {
      if (!active) return;
      const elapsed = Math.min(Math.max((now - last) / 1000, 0), 0.04);
      last = now;

      if (engine.mode === "idle") {
        engine.outer.position = target;
        engine.outer.velocity = 0;
        engine.ambientFrame.velocity = dampedValue(
          engine.ambientFrame.velocity,
          IDLE_FRAME_DEGREES_PER_SECOND,
          elapsed,
          3.2,
        );
        engine.ambientFrame.position += engine.ambientFrame.velocity * elapsed;
        engine.inner.velocity = dampedValue(
          engine.inner.velocity,
          IDLE_INNER_DEGREES_PER_SECOND,
          elapsed,
          3.2,
        );
        engine.inner.position += engine.inner.velocity * elapsed;
        render();
        frame = requestFrame(tick);
        return;
      }

      engine.ambientFrame.velocity = dampedValue(engine.ambientFrame.velocity, 0, elapsed, 7.5);
      engine.ambientFrame.position += engine.ambientFrame.velocity * elapsed;
      integrateSpring(engine.outer, target, elapsed, OUTER_DIAL_SPRING);
      const innerTarget = nearestEquivalentAngle(
        DIAL_INNER_RATIO * engine.outer.position,
        engine.inner.position,
      );
      integrateSpring(engine.inner, innerTarget, elapsed, INNER_DIAL_SPRING);
      render();

      const settledInnerTarget = nearestEquivalentAngle(
        DIAL_INNER_RATIO * target,
        engine.inner.position,
      );
      const moving =
        !springIsSettled(engine.outer, target) ||
        !springIsSettled(engine.inner, settledInnerTarget) ||
        Math.abs(engine.ambientFrame.velocity) >= 0.05;
      if (moving) {
        frame = requestFrame(tick);
        return;
      }

      engine.outer.position = target;
      engine.outer.velocity = 0;
      engine.inner.position = settledInnerTarget;
      engine.inner.velocity = 0;
      engine.ambientFrame.velocity = 0;
      engine.mode = interactionActive ? "paused" : "idle";
      render();
      frame = engine.mode === "idle" ? requestFrame(tick) : 0;
    };

    render();
    frame = requestFrame(tick);

    return () => {
      active = false;
      if (frame) cancelFrame(frame);
    };
  }, [interactionActive, reducedMotion, targetIndex]);

  return {
    initialRotation: initialRotationRef.current,
    initialInnerRotation: DIAL_INNER_RATIO * initialRotationRef.current,
    initialAmbientRotation: 0,
    outerRotorRef,
    innerRotorRef,
    ambientRotorRef,
    rotationReadoutRef,
    velocityReadoutRef,
    velocityBarRef,
    motionStateRef,
    setNumberRef,
  };
}
