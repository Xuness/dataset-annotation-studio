import type { HomeSpace } from "../../../../navigation/spaceRegistry";
import { DialArchiveWindowControls } from "../../components/DialArchivePrimitives";
import { useSystemClock } from "../../hooks/useSystemClock";
import {
  dialArchiveUsesCustomTitlebar,
  handleDialArchiveTitlebarDoubleClick,
} from "../../model/dialArchiveWindow";
import { getDialArchiveSpace } from "../../model/spacePresentation";

interface SpaceChromeProps {
  space: HomeSpace;
  tone?: "light" | "dark";
}

export function SpaceChrome({ space, tone = "light" }: SpaceChromeProps) {
  const clock = useSystemClock();
  const presentation = getDialArchiveSpace(space.id);
  const customTitlebar = dialArchiveUsesCustomTitlebar();

  return (
    <header
      className={`dial-archive-space-chrome${tone === "dark" ? " is-dark" : ""}`}
      data-tauri-drag-region={customTitlebar ? "" : undefined}
      onDoubleClick={handleDialArchiveTitlebarDoubleClick}
    >
      <div className="dial-archive-space-chrome__brand" data-tauri-drag-region="">
        <i aria-hidden="true" data-tauri-drag-region="" />
        <span data-tauri-drag-region="">DATASET ANNOTATION STUDIO</span>
      </div>
      <div className="dial-archive-space-chrome__system">
        <span>
          SPACE.{space.index} // {presentation.code}
        </span>
        <time>{clock}</time>
        <span>SYS.READY</span>
        <DialArchiveWindowControls />
      </div>
    </header>
  );
}
