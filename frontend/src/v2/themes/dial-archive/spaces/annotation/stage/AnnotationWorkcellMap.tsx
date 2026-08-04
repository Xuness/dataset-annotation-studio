import { memo } from "react";

import {
  ANNOTATION_WORKCELL_IDS,
  type AnnotationCoverageLane,
  type AnnotationOperationSummary,
  type AnnotationStageAsset,
  type AnnotationWorkcellId,
} from "../../../../../pages/spaces/spacePageModel";
import { createStageWorkcellPlaneStyle } from "./model/annotationStageLayout";
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
      aria-hidden={focusedWorkcell !== null || undefined}
      data-stage-camera-lock
    >
      {ANNOTATION_WORKCELL_IDS.map((workcell) => {
        const presentation = ANNOTATION_WORKCELL_PRESENTATION[workcell];
        const status = describeWorkcellStatus(
          workcell,
          asset,
          checkedCount,
          totalCount,
          channels,
          operation,
        );
        const focused = focusedWorkcell === workcell;
        const style = createStageWorkcellPlaneStyle(workcell);

        return (
          <div
            className={`dial-archive-stage-workcell-slot is-${workcell}`}
            style={style}
            key={workcell}
          >
            <button
              className={`dial-archive-stage-workcell is-${workcell}${focused ? " is-focused" : ""}${status.live ? " is-live" : ""}`}
              type="button"
              tabIndex={focusedWorkcell ? -1 : undefined}
              aria-label={`${presentation.action} ${presentation.title}`}
              onClick={() => onOpenWorkcell(workcell)}
            >
              <span className="dial-archive-stage-workcell__hit-target" aria-hidden="true" />
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
          </div>
        );
      })}
    </section>
  );
});
