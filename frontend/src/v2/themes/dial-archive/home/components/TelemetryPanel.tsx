import type { DialMotionBindings } from "../hooks/useDialMotion";
import type { DialArchiveSpace } from "../../model/spacePresentation";

interface TelemetryPanelProps {
  motion: DialMotionBindings;
  selectedSpace: DialArchiveSpace;
}

export function TelemetryPanel({ motion, selectedSpace }: TelemetryPanelProps) {
  return (
    <aside className="dial-archive-telemetry" aria-hidden="true">
      <div className="dial-archive-telemetry__header">
        <span>TELEMETRY</span>
        <b>±</b>
      </div>
      <div className="dial-archive-telemetry__rows">
        <div className="dial-archive-telemetry__row">
          <span>ROT</span>
          <b ref={motion.rotationReadoutRef}>+000.0°</b>
          <i className="dial-archive-telemetry__bar">
            <span ref={motion.velocityBarRef} />
          </i>
        </div>
        <div className="dial-archive-telemetry__row">
          <span>VEL</span>
          <b ref={motion.velocityReadoutRef}>000°/s</b>
        </div>
        <div className="dial-archive-telemetry__row">
          <span>CH</span>
          <b>
            {selectedSpace.index} // {selectedSpace.code}
          </b>
          <em ref={motion.motionStateRef}>LOCK</em>
        </div>
      </div>
    </aside>
  );
}
