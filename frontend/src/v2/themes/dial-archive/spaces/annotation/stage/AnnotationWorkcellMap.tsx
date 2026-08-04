import { memo, type CSSProperties } from "react";

import {
  ANNOTATION_WORKCELL_IDS,
  type AnnotationCoverageLane,
  type AnnotationOperationSummary,
  type AnnotationStageAsset,
  type AnnotationWorkcellId,
} from "../../../../../pages/spaces/spacePageModel";
import { ANNOTATION_STAGE_LAYOUT } from "./model/annotationStageLayout";
import {
  ANNOTATION_WORKCELL_PRESENTATION,
  describeWorkcellStatus,
} from "./model/annotationStagePresentation";

/**
 * 后方工作间中景层。
 * 固定命中面负责可靠点击，内部视觉面才承担 3D 旋转与悬停前移，避免目标从指针下逃走。
 */
interface AnnotationWorkcellMapProps {
  asset: AnnotationStageAsset | null;
  totalCount: number;
  checkedCount: number;
  channels: readonly AnnotationCoverageLane[];
  operation: AnnotationOperationSummary | null;
  focusedWorkcell: AnnotationWorkcellId | null;
  onOpenWorkcell(workcell: AnnotationWorkcellId): void;
}

export const AnnotationWorkcellMap = memo(function AnnotationWorkcellMap({
  asset,
  totalCount,
  checkedCount,
  channels,
  operation,
  focusedWorkcell,
  onOpenWorkcell,
}: AnnotationWorkcellMapProps) {
  return (
    <section
      className="dial-archive-stage-workcell-field"
      aria-label="后方工作间入口"
      data-stage-camera-lock
    >
      {ANNOTATION_WORKCELL_IDS.map((workcell) => {
        const presentation = ANNOTATION_WORKCELL_PRESENTATION[workcell];
        const plane = ANNOTATION_STAGE_LAYOUT.workcells.planes[workcell];
        const status = describeWorkcellStatus(
          workcell,
          asset,
          checkedCount,
          totalCount,
          channels,
          operation,
        );
        const focused = focusedWorkcell === workcell;
        const style = {
          "--dial-archive-workcell-left": `${plane.leftPercent}%`,
          "--dial-archive-workcell-top": `${plane.topPercent}%`,
          "--dial-archive-workcell-width": `${plane.width}px`,
          "--dial-archive-workcell-height": `${plane.height}px`,
          "--dial-archive-workcell-z": `${plane.translateZ}px`,
          "--dial-archive-workcell-rx": `${plane.rotateX}deg`,
          "--dial-archive-workcell-ry": `${plane.rotateY}deg`,
          "--dial-archive-workcell-rz": `${plane.rotateZ}deg`,
          "--dial-archive-workcell-idle-x": `${plane.idleX}px`,
          "--dial-archive-workcell-idle-y": `${plane.idleY}px`,
          "--dial-archive-workcell-idle-duration": `${plane.idleSeconds}s`,
          "--dial-archive-workcell-idle-delay": `${plane.idleDelay}s`,
          "--dial-archive-workcell-preview-lift": `${ANNOTATION_STAGE_LAYOUT.workcells.previewLift}px`,
        } as CSSProperties;

        return (
          <button
            className={`dial-archive-stage-workcell is-${workcell}${focused ? " is-focused" : ""}${status.live ? " is-live" : ""}`}
            type="button"
            aria-label={`${presentation.action} ${presentation.title}`}
            style={style}
            onClick={() => onOpenWorkcell(workcell)}
            key={workcell}
          >
            <span className="dial-archive-stage-workcell__plane">
              <span className="dial-archive-stage-workcell__rear" aria-hidden="true" />
              <span className="dial-archive-stage-workcell__surface">
                <span className="dial-archive-stage-workcell__edge" aria-hidden="true" />
                <span className="dial-archive-stage-workcell__kicker">
                  ACCESS VECTOR <i aria-hidden="true" /> {presentation.code}
                </span>
                <span className="dial-archive-stage-workcell__identity">
                  <b>{presentation.englishTitle}</b>
                  <em>{presentation.title}</em>
                </span>
                <span className="dial-archive-stage-workcell__status">
                  {status.live ? <i aria-hidden="true" /> : null}
                  {status.label}
                </span>
                <span className="dial-archive-stage-workcell__diagram" aria-hidden="true">
                  <i />
                  <i />
                  <i />
                  <i />
                </span>
                <span className="dial-archive-stage-workcell__action" aria-hidden="true">
                  {presentation.action} →
                </span>
              </span>
            </span>
          </button>
        );
      })}
    </section>
  );
});
