import type { CSSProperties } from "react";

import type { HomeSpace, HomeSpaceId } from "../../../../navigation/spaceRegistry";
import { DIAL_ARCHIVE_SPACES } from "../../model/spacePresentation";

interface SpaceRailProps {
  currentSpace: HomeSpace;
  intentSpaceId: HomeSpaceId;
  routing: boolean;
  onRequestSpace(spaceId: HomeSpaceId): void;
  onReturnHome(): void;
}

interface RailCursorStyle extends CSSProperties {
  "--dial-archive-space-index": number;
}

export function SpaceRail({
  currentSpace,
  intentSpaceId,
  routing,
  onRequestSpace,
  onReturnHome,
}: SpaceRailProps) {
  const intentIndex = DIAL_ARCHIVE_SPACES.findIndex((space) => space.id === intentSpaceId);
  return (
    <nav className="dial-archive-space-rail" aria-label="内容空间">
      <div className="dial-archive-space-rail__track">
        <div
          className={`dial-archive-space-rail__cursor${routing ? " is-routing" : ""}`}
          style={{ "--dial-archive-space-index": intentIndex } as RailCursorStyle}
          aria-hidden="true"
        />
        <ol className="dial-archive-space-rail__list">
          {DIAL_ARCHIVE_SPACES.map((space) => {
            const intended = space.id === intentSpaceId;
            const current = space.id === currentSpace.id;
            return (
              <li key={space.id}>
                <button
                  className={`dial-archive-space-rail__link${intended ? " is-current" : ""}`}
                  type="button"
                  aria-current={current ? "page" : undefined}
                  aria-label={`进入空间 ${space.index} ${space.label}`}
                  onClick={() => onRequestSpace(space.id)}
                >
                  <span className="dial-archive-space-rail__number">{space.index}</span>
                  <span className="dial-archive-space-rail__code">{space.code}</span>
                  <span className="dial-archive-space-rail__label">
                    <b>{space.label}</b>
                    <em>{space.englishLabel}</em>
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      </div>
      <button className="dial-archive-space-rail__return" type="button" onClick={onReturnHome}>
        <i aria-hidden="true">◀</i>
        <span>HOME</span>
      </button>
    </nav>
  );
}
