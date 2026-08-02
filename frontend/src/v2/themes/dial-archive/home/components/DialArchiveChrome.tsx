import {
  DialArchiveBarcode,
  DialArchiveWindowControls,
} from "../../components/DialArchivePrimitives";
import { useSystemClock } from "../../hooks/useSystemClock";
import {
  dialArchiveUsesCustomTitlebar,
  handleDialArchiveTitlebarDoubleClick,
} from "../../model/dialArchiveWindow";
import type { DialArchiveSpace } from "../../model/spacePresentation";

const fontLicenseUrl = new URL("../../assets/fonts/OFL-1.1.txt", import.meta.url).href;

interface DialArchiveChromeProps {
  selectedSpace: DialArchiveSpace;
}

export function DialArchiveChrome({ selectedSpace }: DialArchiveChromeProps) {
  const clock = useSystemClock();
  const customTitlebar = dialArchiveUsesCustomTitlebar();

  return (
    <>
      <header
        className="dial-archive-chrome__topbar"
        data-tauri-drag-region={customTitlebar ? "" : undefined}
        onDoubleClick={handleDialArchiveTitlebarDoubleClick}
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
          <DialArchiveWindowControls />
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
          <DialArchiveBarcode className="dial-archive-chrome__barcode" />
        </span>
      </footer>
    </>
  );
}
