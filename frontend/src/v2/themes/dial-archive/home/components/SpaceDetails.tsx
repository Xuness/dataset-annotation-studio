import type { DialArchiveSpace } from "../../model/spacePresentation";

interface SpaceDetailsProps {
  space: DialArchiveSpace;
  confirmationVersion: number;
  reducedMotion: boolean;
  onEnter(): void;
}

export function SpaceDetails({
  space,
  confirmationVersion,
  reducedMotion,
  onEnter,
}: SpaceDetailsProps) {
  const confirming = confirmationVersion > 0 && !reducedMotion;
  return (
    <section
      className={`dial-archive-info${confirming ? " is-confirming" : ""}`}
      key={`info-${confirmationVersion}`}
      aria-live="polite"
    >
      <div className="dial-archive-info__kicker">SPACE {space.index} / 06</div>
      <div className="dial-archive-info__heading">
        <h1>{space.englishLabel}</h1>
        <span>{space.label}</span>
      </div>
      <p className="dial-archive-info__description">{space.description}</p>
      <div className="dial-archive-info__specification">
        <span>
          CH <b>{space.index}</b>
        </span>
        <span>
          CODE <b>{space.code}</b>
        </span>
        <span>
          TYPE <b>{space.typeLabel}</b>
        </span>
        <span>
          STATE <b>READY</b>
        </span>
      </div>
      <button className="dial-archive-info__enter" type="button" onClick={onEnter}>
        <span>进入空间</span>
        <b aria-hidden="true">→</b>
      </button>
    </section>
  );
}
