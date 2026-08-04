import { useCallback, useEffect, useRef, useState } from "react";

import type { AnnotationWorkcellId } from "../../../../../../pages/spaces/spacePageModel";
import { ANNOTATION_STAGE_LAYOUT } from "../model/annotationStageLayout";

export type WorkcellTransitionPhase = "overview" | "opening" | "active" | "switching" | "closing";

export interface WorkcellTransitionState {
  phase: WorkcellTransitionPhase;
  displayedWorkcell: AnnotationWorkcellId | null;
  departingWorkcell: AnnotationWorkcellId | null;
  version: number;
}

function settledWorkcellState(
  activeWorkcell: AnnotationWorkcellId | null,
  version: number,
): WorkcellTransitionState {
  return {
    phase: activeWorkcell ? "active" : "overview",
    displayedWorkcell: activeWorkcell,
    departingWorkcell: null,
    version,
  };
}

/**
 * 路由只保存活动工作间，开合、切换和离场编排留在主题内部。
 * 新的明确意图会取消旧计时器并接管最终状态，避免快速切换积累动画。
 */
export function useWorkcellTransition(
  activeWorkcell: AnnotationWorkcellId | null,
  reducedMotion: boolean,
): WorkcellTransitionState {
  const serialRef = useRef(0);
  const timerRef = useRef(0);
  const previousActiveRef = useRef(activeWorkcell);
  const [state, setState] = useState<WorkcellTransitionState>(() =>
    settledWorkcellState(activeWorkcell, 0),
  );
  const stateRef = useRef(state);
  const commitState = useCallback((next: WorkcellTransitionState) => {
    stateRef.current = next;
    setState(next);
  }, []);

  useEffect(() => {
    window.clearTimeout(timerRef.current);

    if (reducedMotion) {
      previousActiveRef.current = activeWorkcell;
      serialRef.current += 1;
      commitState(settledWorkcellState(activeWorkcell, serialRef.current));
      return;
    }

    const previousActive = previousActiveRef.current;
    if (previousActive === activeWorkcell) return;
    previousActiveRef.current = activeWorkcell;
    serialRef.current += 1;
    const version = serialRef.current;
    const displayed = stateRef.current.displayedWorkcell ?? previousActive;
    const { motion } = ANNOTATION_STAGE_LAYOUT;

    if (!activeWorkcell) {
      if (!displayed) {
        commitState(settledWorkcellState(null, version));
        return;
      }
      commitState({
        phase: "closing",
        displayedWorkcell: displayed,
        departingWorkcell: null,
        version,
      });
      timerRef.current = window.setTimeout(() => {
        if (serialRef.current === version) commitState(settledWorkcellState(null, version));
      }, motion.workcellCloseDurationMs);
      return;
    }

    if (!displayed) {
      commitState({
        phase: "opening",
        displayedWorkcell: activeWorkcell,
        departingWorkcell: null,
        version,
      });
      timerRef.current = window.setTimeout(() => {
        if (serialRef.current === version) {
          commitState(settledWorkcellState(activeWorkcell, version));
        }
      }, motion.workcellOpenDurationMs);
      return;
    }

    commitState({
      phase: "switching",
      displayedWorkcell: activeWorkcell,
      departingWorkcell: displayed,
      version,
    });
    timerRef.current = window.setTimeout(() => {
      if (serialRef.current === version) {
        commitState(settledWorkcellState(activeWorkcell, version));
      }
    }, motion.workcellSwitchDurationMs);
  }, [activeWorkcell, commitState, reducedMotion]);

  useEffect(
    () => () => {
      window.clearTimeout(timerRef.current);
    },
    [],
  );

  return state;
}
