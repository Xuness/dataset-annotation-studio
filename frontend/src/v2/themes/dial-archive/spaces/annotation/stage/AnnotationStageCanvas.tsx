import { memo, useMemo, type CSSProperties } from "react";

import type { AnnotationStageAsset } from "../../../../../pages/spaces/spacePageModel";
import {
  ANNOTATION_STAGE_LAYOUT,
  createStageRegistrationField,
} from "./model/annotationStageLayout";
import { selectStageEvidenceAssets } from "./model/annotationStagePresentation";

/**
 * 施工场底座（Z0）：冷白编辑纸面、登记点阵、结构导线与远景证据看板。
 * 纯装饰层，pointer-events 全部关闭；点阵与构件几何来自布局模型。
 */

function RegistrationLayer({
  points,
  className,
}: {
  points: readonly { x: number; y: number; radius: number; opacity: number }[];
  className: string;
}) {
  const { frame } = ANNOTATION_STAGE_LAYOUT;
  return (
    <svg
      className={className}
      viewBox={`0 0 ${frame.width} ${frame.height}`}
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
    >
      {points.map((point, index) => (
        <circle cx={point.x} cy={point.y} r={point.radius} opacity={point.opacity} key={index} />
      ))}
    </svg>
  );
}

interface AnnotationStageCanvasProps {
  evidenceAssets: readonly AnnotationStageAsset[];
  currentIndex: number;
  checkedAssetIds: readonly string[];
}

export const AnnotationStageCanvas = memo(function AnnotationStageCanvas({
  evidenceAssets,
  currentIndex,
  checkedAssetIds,
}: AnnotationStageCanvasProps) {
  const registrationField = useMemo(() => createStageRegistrationField(), []);
  const { evidence, registrationGuides } = ANNOTATION_STAGE_LAYOUT;
  const visibleEvidence = selectStageEvidenceAssets(
    evidenceAssets,
    currentIndex,
    checkedAssetIds,
    evidence.length,
  );

  return (
    <div className="dial-archive-stage-canvas" aria-hidden="true">
      <div className="dial-archive-stage-canvas__paper" />
      <div className="dial-archive-stage-canvas__crop is-left" />
      <div className="dial-archive-stage-canvas__crop is-right" />
      <RegistrationLayer
        points={registrationField.ambient}
        className="dial-archive-stage-canvas__points is-ambient"
      />
      <RegistrationLayer
        points={registrationField.measure}
        className="dial-archive-stage-canvas__points is-measure"
      />
      <RegistrationLayer
        points={registrationField.flow}
        className="dial-archive-stage-canvas__points is-flow"
      />
      <svg
        className="dial-archive-stage-canvas__guides"
        viewBox={`0 0 ${ANNOTATION_STAGE_LAYOUT.frame.width} ${ANNOTATION_STAGE_LAYOUT.frame.height}`}
        preserveAspectRatio="xMidYMid slice"
      >
        {registrationGuides.map((guide) => (
          <path className={`is-${guide.tone}`} d={guide.path} key={guide.id} />
        ))}
        <rect
          className="dial-archive-stage-canvas__spine-node"
          x="1362"
          y="412"
          width="16"
          height="16"
        />
      </svg>
      <div className="dial-archive-stage-canvas__evidence">
        {visibleEvidence.map((asset, index) => {
          const slot = evidence[index];
          return (
            <figure
              className={`dial-archive-stage-canvas__board is-${slot.id}`}
              style={
                {
                  left: `${slot.leftPercent}%`,
                  top: `${slot.topPercent}%`,
                  width: slot.width,
                  "--dial-archive-evidence-yaw": `${slot.rotateY}deg`,
                  "--dial-archive-evidence-roll": `${slot.rotateZ}deg`,
                  "--dial-archive-evidence-z": `${slot.translateZ}px`,
                  "--dial-archive-evidence-drift-x": `${slot.driftX}px`,
                  "--dial-archive-evidence-drift-y": `${slot.driftY}px`,
                  "--dial-archive-evidence-drift-duration": `${slot.driftSeconds}s`,
                  "--dial-archive-evidence-drift-delay": `${slot.driftDelay}s`,
                } as CSSProperties
              }
              key={asset.id}
            >
              <span className="dial-archive-stage-canvas__board-surface">
                <span className="dial-archive-stage-canvas__board-register" />
                <img src={asset.thumbnailUrl} alt="" draggable={false} loading="lazy" />
                <figcaption>
                  <span>{slot.code}</span>
                  <small>
                    {asset.width} × {asset.height}
                  </small>
                </figcaption>
              </span>
            </figure>
          );
        })}
      </div>
      <div className="dial-archive-stage-canvas__ghost-word">
        <span>MATERIAL</span>
        <small>SPECIMEN CONSTRUCTION FIELD // SPACE 03</small>
      </div>
      <div className="dial-archive-stage-canvas__section-mark">
        <b>03</b>
        <span>MATERIAL / WORKCELL ACCESS</span>
      </div>
    </div>
  );
});
