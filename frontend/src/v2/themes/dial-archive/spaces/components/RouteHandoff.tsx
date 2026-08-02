import type { CSSProperties } from "react";

import type { HomeSpaceId } from "../../../../navigation/spaceRegistry";
import { getDialArchiveSpace } from "../../model/spacePresentation";

interface RouteHandoffProps {
  spaceId: HomeSpaceId;
  running: boolean;
  version: number;
}

interface HandoffStyle extends CSSProperties {
  "--dial-archive-space-index": number;
}

export function RouteHandoff({ spaceId, running, version }: RouteHandoffProps) {
  const space = getDialArchiveSpace(spaceId);
  return (
    <div
      className={`dial-archive-space-handoff${running ? " is-running" : ""}`}
      style={{ "--dial-archive-space-index": Number.parseInt(space.index, 10) - 1 } as HandoffStyle}
      key={running ? `route-handoff-${version}` : "route-handoff-idle"}
      role="status"
      aria-live="assertive"
    >
      <span>
        SPACE {space.index} // {space.code} — {space.englishLabel.toUpperCase()}
      </span>
    </div>
  );
}
