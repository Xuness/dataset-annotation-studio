import { Minus, Square, X } from "lucide-react";

import appIconUrl from "../../../src/assets/app-icon.png";
import {
  closeDesktopWindow,
  minimizeDesktopWindow,
  toggleDesktopWindowMaximized,
  usesCustomDesktopTitlebar,
} from "../../../src/shared/desktop/windowControls";
import "./legacy-desktop-titlebar.css";

function runWindowAction(action: () => Promise<void>) {
  void action().catch(() => undefined);
}

export function LegacyDesktopTitlebar() {
  if (!usesCustomDesktopTitlebar()) return null;

  return (
    <header className="desktop-titlebar">
      <div
        className="desktop-titlebar__drag-region"
        data-tauri-drag-region=""
        onDoubleClick={() => runWindowAction(toggleDesktopWindowMaximized)}
      >
        <span className="desktop-titlebar__mark" aria-hidden="true" data-tauri-drag-region="">
          <img src={appIconUrl} alt="" draggable={false} data-tauri-drag-region="" />
        </span>
        <span data-tauri-drag-region="">Dataset Studio</span>
      </div>
      <div className="desktop-titlebar__controls" aria-label="窗口控制">
        <button
          type="button"
          aria-label="最小化"
          title="最小化"
          onClick={() => runWindowAction(minimizeDesktopWindow)}
        >
          <Minus size={14} strokeWidth={1.5} aria-hidden="true" />
        </button>
        <button
          type="button"
          aria-label="最大化或还原"
          title="最大化或还原"
          onClick={() => runWindowAction(toggleDesktopWindowMaximized)}
        >
          <Square size={11} strokeWidth={1.4} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="desktop-titlebar__close"
          aria-label="关闭窗口"
          title="关闭窗口"
          onClick={() => runWindowAction(closeDesktopWindow)}
        >
          <X size={14} strokeWidth={1.45} aria-hidden="true" />
        </button>
      </div>
    </header>
  );
}
