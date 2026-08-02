import type { DialArchiveSpace } from "../../model/spacePresentation";

interface CoreReadoutProps {
  space: DialArchiveSpace;
  motionVersion: number;
  reducedMotion: boolean;
}

export function CoreReadout({ space, motionVersion, reducedMotion }: CoreReadoutProps) {
  const animated = motionVersion > 0 && !reducedMotion;
  return (
    <div className="dial-archive-core" aria-hidden="true">
      <div
        className={`dial-archive-core__frame${animated ? " is-pulsing" : ""}`}
        key={`frame-${motionVersion}`}
      >
        <div className={`dial-archive-core__block${animated ? " is-wiping" : ""}`}>
          <span className={`dial-archive-core__number${animated ? " is-entering" : ""}`}>
            {space.index}
          </span>
          <span className={`dial-archive-core__scan${animated ? " is-running" : ""}`} />
        </div>
      </div>
      <div className="dial-archive-core__meta">
        CH.{space.index} // {space.code} // READY
      </div>
    </div>
  );
}
