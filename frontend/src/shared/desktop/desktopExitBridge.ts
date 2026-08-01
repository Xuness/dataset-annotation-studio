import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { confirm, message } from "@tauri-apps/plugin-dialog";

import {
  ACKNOWLEDGE_EXIT_REQUEST_COMMAND,
  DESKTOP_EXIT_REQUESTED_EVENT,
  EXIT_APPLICATION_COMMAND,
  type DesktopExitRequestPayload,
} from "./desktopExitProtocol";
import { isDesktopRuntime } from "./runtime";

export function canHandleDesktopExitRequests(): boolean {
  return isDesktopRuntime();
}

export function acknowledgeDesktopExitRequest(requestId: number): Promise<boolean> {
  return invoke<boolean>(ACKNOWLEDGE_EXIT_REQUEST_COMMAND, { requestId });
}

export function listenForDesktopExitRequest(
  handler: (payload: DesktopExitRequestPayload) => void,
): Promise<UnlistenFn> {
  return listen<DesktopExitRequestPayload>(DESKTOP_EXIT_REQUESTED_EVENT, (event) => {
    handler(event.payload);
  });
}

export function confirmDesktopWarning(text: string, title: string): Promise<boolean> {
  return confirm(text, { title, kind: "warning" });
}

export function showDesktopWarning(text: string, title: string): Promise<unknown> {
  return message(text, { title, kind: "warning" });
}

export async function exitDesktopApplication(): Promise<void> {
  await invoke(EXIT_APPLICATION_COMMAND);
}
