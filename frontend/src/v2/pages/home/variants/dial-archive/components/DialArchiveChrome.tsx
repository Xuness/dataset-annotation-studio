import {
  closeDesktopWindow,
  minimizeDesktopWindow,
  toggleDesktopWindowMaximized,
  usesCustomDesktopTitlebar,
} from "../../../../../../shared/desktop/windowControls";
import { useSystemClock } from "../hooks/useSystemClock";
import type { DialArchiveSpace } from "../model/spacePresentation";

const fontLicenseUrl = new URL("../assets/fonts/OFL-1.1.txt", import.meta.url).href;

interface DialArchiveChromeProps {
  selectedSpace: DialArchiveSpace;
}

function runWindowAction(action: () => Promise<void>): void {
  void action().catch(() => undefined);
}

function WindowControls() {
  if (!usesCustomDesktopTitlebar()) {
    return (
      <span className="dial-archive-chrome__window-glyphs" aria-hidden="true">
        — ▢ ✕
      </span>
    );
  }

  return (
    <span className="dial-archive-chrome__window-controls">
      <button
        type="button"
        aria-label="最小化窗口"
        onClick={() => runWindowAction(minimizeDesktopWindow)}
      >
        —
      </button>
      <button
        type="button"
        aria-label="切换最大化窗口"
        onClick={() => runWindowAction(toggleDesktopWindowMaximized)}
      >
        ▢
      </button>
      <button
        type="button"
        aria-label="关闭窗口"
        onClick={() => runWindowAction(closeDesktopWindow)}
      >
        ✕
      </button>
    </span>
  );
}

function Barcode() {
  return (
    <svg className="dial-archive-chrome__barcode" viewBox="0 0 34 11" aria-hidden="true">
      <rect x="0" width="2" height="11" />
      <rect x="4" width="1" height="11" />
      <rect x="7" width="3" height="11" />
      <rect x="12" width="1" height="11" />
      <rect x="15" width="2" height="11" />
      <rect x="19" width="1" height="11" />
      <rect x="22" width="4" height="11" />
      <rect x="28" width="1" height="11" />
      <rect x="31" width="2" height="11" />
    </svg>
  );
}

export function DialArchiveChrome({ selectedSpace }: DialArchiveChromeProps) {
  const clock = useSystemClock();
  const customTitlebar = usesCustomDesktopTitlebar();
  const handleDoubleClick = () => {
    if (customTitlebar) runWindowAction(toggleDesktopWindowMaximized);
  };

  return (
    <>
      <header
        className="dial-archive-chrome__topbar"
        data-tauri-drag-region={customTitlebar ? "" : undefined}
        onDoubleClick={handleDoubleClick}
      >
        <div className="dial-archive-chrome__brand" data-tauri-drag-region="">
          <i aria-hidden="true" data-tauri-drag-region="" />
          <span data-tauri-drag-region="">DATASET ANNOTATION STUDIO</span>
        </div>
        <div className="dial-archive-chrome__system">
          <span>
            CH.{selectedSpace.index} // {selectedSpace.code}
          </span>
          <time>{clock}</time>
          <span>SYS.READY</span>
          <WindowControls />
        </div>
      </header>

      <footer className="dial-archive-chrome__bottombar">
        <span>STUDIO//DESK</span>
        <nav className="dial-archive-chrome__tools" aria-label="辅助入口">
          <span aria-disabled="true">运行中心</span>
          <span aria-disabled="true">设置</span>
          <a href={fontLicenseUrl} target="_blank" rel="noreferrer">
            许可
          </a>
          <a href="/legacy.html">LEGACY</a>
        </nav>
        <span className="dial-archive-chrome__version">
          THEME.R1 // DIAL ARCHIVE
          <Barcode />
        </span>
      </footer>
    </>
  );
}
