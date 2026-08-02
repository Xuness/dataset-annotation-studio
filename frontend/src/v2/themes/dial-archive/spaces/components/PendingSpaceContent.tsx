import type { HomeSpace } from "../../../../navigation/spaceRegistry";
import { getDialArchiveSpace } from "../../model/spacePresentation";

export function PendingSpaceContent({ space }: { space: HomeSpace }) {
  const presentation = getDialArchiveSpace(space.id);
  return (
    <section className="dial-archive-pending-space" aria-label={`${space.label}空间`}>
      <div className="dial-archive-space-frame">
        <div
          className="dial-archive-pending-space__word"
          data-dial-archive-entry
          aria-hidden="true"
        >
          {presentation.ghostLabel}
        </div>
        <div className="dial-archive-pending-space__body" data-dial-archive-entry>
          <div>
            <div className="dial-archive-space-kicker">
              <i aria-hidden="true" />
              <span>
                SPACE {space.index} // {presentation.code} — {space.englishLabel.toUpperCase()}
              </span>
            </div>
            <h1>{space.label}</h1>
            <p>{space.description}</p>
          </div>
          <div className="dial-archive-pending-space__state">
            <div>SECONDARY SPACE //</div>
            <div>SPACE {space.index} / 06</div>
            <div>CONTENT PENDING</div>
          </div>
        </div>
      </div>
    </section>
  );
}
