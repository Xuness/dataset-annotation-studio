export const DESKTOP_EXIT_REQUESTED_EVENT = "desktop-exit-requested";
export const EXIT_APPLICATION_COMMAND = "exit_application";
export const ACKNOWLEDGE_EXIT_REQUEST_COMMAND = "acknowledge_exit_request";

export interface DesktopExitRequestPayload {
  request_id: number;
}
