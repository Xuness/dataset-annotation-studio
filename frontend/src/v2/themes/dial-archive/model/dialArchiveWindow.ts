import {
  closeDesktopWindow,
  minimizeDesktopWindow,
  toggleDesktopWindowMaximized,
  usesCustomDesktopTitlebar,
} from "../../../../shared/desktop/windowControls";

function runWindowAction(action: () => Promise<void>): void {
  void action().catch(() => undefined);
}

export function minimizeDialArchiveWindow(): void {
  runWindowAction(minimizeDesktopWindow);
}

export function toggleDialArchiveWindowMaximized(): void {
  runWindowAction(toggleDesktopWindowMaximized);
}

export function closeDialArchiveWindow(): void {
  runWindowAction(closeDesktopWindow);
}

export function handleDialArchiveTitlebarDoubleClick(): void {
  if (usesCustomDesktopTitlebar()) toggleDialArchiveWindowMaximized();
}

export function dialArchiveUsesCustomTitlebar(): boolean {
  return usesCustomDesktopTitlebar();
}
