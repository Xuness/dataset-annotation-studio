import { useEffect, useRef } from "react";

import { getActiveJobs, stopAllWorkspaceJobs } from "../features/jobs/api";
import {
  acknowledgeDesktopExitRequest,
  canHandleDesktopExitRequests,
  confirmDesktopWarning,
  exitDesktopApplication,
  listenForDesktopExitRequest,
  showDesktopWarning,
} from "../shared/desktop/desktopExitBridge";
import { useUnsavedChangesStore } from "../shared/store/unsavedChangesStore";
import { runDesktopExit } from "./desktopExit";

export function useCloseGuard(): void {
  const hasUnsavedChanges = useUnsavedChangesStore(
    (state) => Object.keys(state.dirtyScopes).length > 0,
  );
  const hasUnsavedChangesRef = useRef(hasUnsavedChanges);
  const exitRequestInFlightRef = useRef(false);

  useEffect(() => {
    hasUnsavedChangesRef.current = hasUnsavedChanges;
  }, [hasUnsavedChanges]);

  useEffect(() => {
    if (!hasUnsavedChanges) return;
    const preventAccidentalUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", preventAccidentalUnload);
    return () => window.removeEventListener("beforeunload", preventAccidentalUnload);
  }, [hasUnsavedChanges]);

  useEffect(() => {
    if (!canHandleDesktopExitRequests()) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;

    const requestExit = (requestId: number) => {
      if (!Number.isSafeInteger(requestId) || requestId <= 0) return;
      const acknowledgeRequest = () => acknowledgeDesktopExitRequest(requestId);

      if (exitRequestInFlightRef.current) {
        void acknowledgeRequest().catch(() => undefined);
        return;
      }
      exitRequestInFlightRef.current = true;
      void acknowledgeRequest()
        .then(() =>
          runDesktopExit(hasUnsavedChangesRef.current, {
            confirm: (text, options) => confirmDesktopWarning(text, options.title),
            message: (text, options) => showDesktopWarning(text, options.title),
            getActiveJobs,
            stopAllWorkspaceJobs,
            delay: (milliseconds) =>
              new Promise((resolve) => window.setTimeout(resolve, milliseconds)),
            exitApplication: exitDesktopApplication,
          }),
        )
        .catch(() => undefined)
        .finally(() => {
          exitRequestInFlightRef.current = false;
        });
    };

    void listenForDesktopExitRequest((payload) => {
      requestExit(payload.request_id);
    })
      .then((stopListening) => {
        if (disposed) stopListening();
        else unlisten = stopListening;
      })
      .catch(() => undefined);

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);
}
