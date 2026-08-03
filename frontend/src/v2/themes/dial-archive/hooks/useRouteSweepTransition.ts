import { useCallback, useEffect, useRef, useState } from "react";

export const DIAL_ARCHIVE_ROUTE_SWEEP_COMMIT_MS = 520;
const DIAL_ARCHIVE_ROUTE_SWEEP_FINISH_MS = 700;

interface RouteSweepState {
  label: string;
  running: boolean;
  version: number;
}

interface RouteSweepRequest {
  label: string;
  onCommit(): void;
}

interface UseRouteSweepTransitionOptions {
  reducedMotion: boolean;
}

export function useRouteSweepTransition({ reducedMotion }: UseRouteSweepTransitionOptions) {
  const [state, setState] = useState<RouteSweepState>({
    label: "",
    running: false,
    version: 0,
  });
  const activeRef = useRef(false);
  const timersRef = useRef<number[]>([]);

  const clearTimers = useCallback(() => {
    timersRef.current.forEach((timer) => window.clearTimeout(timer));
    timersRef.current = [];
  }, []);

  useEffect(() => clearTimers, [clearTimers]);

  const start = useCallback(
    ({ label, onCommit }: RouteSweepRequest) => {
      if (reducedMotion) {
        onCommit();
        return;
      }
      if (activeRef.current) return;

      activeRef.current = true;
      clearTimers();
      setState((current) => ({
        label,
        running: true,
        version: current.version + 1,
      }));

      timersRef.current = [
        window.setTimeout(onCommit, DIAL_ARCHIVE_ROUTE_SWEEP_COMMIT_MS),
        window.setTimeout(() => {
          activeRef.current = false;
          setState((current) => ({ ...current, running: false }));
        }, DIAL_ARCHIVE_ROUTE_SWEEP_FINISH_MS),
      ];
    },
    [clearTimers, reducedMotion],
  );

  return { ...state, start };
}
