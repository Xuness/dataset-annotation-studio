import { useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { confirm, message } from "@tauri-apps/plugin-dialog";

import { getActiveJobs, stopAllWorkspaceJobs } from "../features/jobs/api";
import { useAppStore } from "../shared/store/appStore";
import {
  DESKTOP_EXIT_REQUESTED_EVENT,
  EXIT_APPLICATION_COMMAND,
  runDesktopExit,
} from "./desktopExit";

function isTauriRuntime(): boolean {
  return "__TAURI_INTERNALS__" in window;
}

export function useCloseGuard(): void {
  const hasUnsavedChanges = useAppStore((state) => Object.keys(state.dirtyScopes).length > 0);
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
    if (!isTauriRuntime()) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;

    const requestExit = () => {
      if (exitRequestInFlightRef.current) return;
      exitRequestInFlightRef.current = true;
      void runDesktopExit(hasUnsavedChangesRef.current, {
        confirm,
        message,
        getActiveJobs,
        stopAllWorkspaceJobs,
        delay: (milliseconds) => new Promise((resolve) => window.setTimeout(resolve, milliseconds)),
        exitApplication: async () => {
          await invoke(EXIT_APPLICATION_COMMAND);
        },
      })
        .catch(() => undefined)
        .finally(() => {
          exitRequestInFlightRef.current = false;
        });
    };

    void listen(DESKTOP_EXIT_REQUESTED_EVENT, requestExit)
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
