import type { ReactNode } from "react";

import type { AnnotationLaneId } from "../../../../../../pages/spaces/spacePageModel";
import {
  ANNOTATION_PRODUCTION_LANE_PRESENTATION,
  ANNOTATION_PRODUCTION_PHASES,
} from "./model/annotationProductionPresentation";

type ProductionPhase = "route" | "snapshot" | "run" | "result";

interface ProductionInstrumentHeaderProps {
  lane: AnnotationLaneId;
  register: string;
  title: string;
  detail: ReactNode;
}

interface ProductionPhaseRailProps {
  active: ProductionPhase;
  label: string;
}

export function ProductionInstrumentHeader({
  lane,
  register,
  title,
  detail,
}: ProductionInstrumentHeaderProps) {
  const identity = ANNOTATION_PRODUCTION_LANE_PRESENTATION[lane];

  return (
    <header className="dial-archive-production-instrument-header">
      <div className="dial-archive-production-instrument-header__identity" aria-hidden="true">
        <span>{identity.index}</span>
        <b>{identity.code}</b>
      </div>
      <div className="dial-archive-production-instrument-header__heading">
        <span>
          {register} // {identity.englishTitle}
        </span>
        <h2>{title}</h2>
        <p>{detail}</p>
      </div>
      <div className="dial-archive-production-instrument-header__ticks" aria-hidden="true">
        {Array.from({ length: 11 }, (_, index) => (
          <i className={index % 5 === 0 ? "is-major" : undefined} key={index} />
        ))}
      </div>
    </header>
  );
}

export function ProductionPhaseRail({ active, label }: ProductionPhaseRailProps) {
  return (
    <div className="dial-archive-production-phase-rail" aria-label={label}>
      {ANNOTATION_PRODUCTION_PHASES.map((phase) => {
        const id = phase.label.toLowerCase() as ProductionPhase;
        return (
          <span className={id === active ? "is-active" : undefined} key={phase.index}>
            <b>{phase.index}</b>
            <i>{phase.label}</i>
          </span>
        );
      })}
    </div>
  );
}
