import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Minus, Square, X } from "lucide-react";

import appIconUrl from "../../assets/app-icon.png";
import "./desktop-titlebar.css";

function runWindowAction(action: () => Promise<void>) {
  void action().catch(() => undefined);
}

export function DesktopTitlebar() {
  if (!isTauri()) return null;

  const appWindow = getCurrentWindow();

  return (
    <header className="desktop-titlebar">
      <div
        className="desktop-titlebar__drag-region"
        data-tauri-drag-region=""
        onDoubleClick={() => runWindowAction(() => appWindow.toggleMaximize())}
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
          onClick={() => runWindowAction(() => appWindow.minimize())}
        >
          <Minus size={14} strokeWidth={1.5} aria-hidden="true" />
        </button>
        <button
          type="button"
          aria-label="最大化或还原"
          title="最大化或还原"
          onClick={() => runWindowAction(() => appWindow.toggleMaximize())}
        >
          <Square size={11} strokeWidth={1.4} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="desktop-titlebar__close"
          aria-label="隐藏到系统托盘"
          title="隐藏到系统托盘"
          onClick={() => runWindowAction(() => appWindow.close())}
        >
          <X size={14} strokeWidth={1.45} aria-hidden="true" />
        </button>
      </div>
    </header>
  );
}
