import { memo, useMemo } from "react";

import type { AnnotationStageAsset } from "../../../../../pages/spaces/spacePageModel";
import { ANNOTATION_STAGE_LAYOUT, createStageStarfield } from "./model/annotationStageLayout";

/**
 * 施工场底座（Z0）：星空虚空、星尘视差层、透视网格地面与远景证据看板。
 * 纯装饰层，pointer-events 全部关闭；星尘坐标来自布局模型的确定性生成。
 */

function StarLayer({
  stars,
  className,
}: {
  stars: readonly { x: number; y: number; radius: number; opacity: number }[];
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
      {stars.map((star, index) => (
        <circle cx={star.x} cy={star.y} r={star.radius} opacity={star.opacity} key={index} />
      ))}
    </svg>
  );
}

interface AnnotationStageCanvasProps {
  evidenceAssets: readonly AnnotationStageAsset[];
}

export const AnnotationStageCanvas = memo(function AnnotationStageCanvas({
  evidenceAssets,
}: AnnotationStageCanvasProps) {
  const starfield = useMemo(() => createStageStarfield(), []);
  const { evidence } = ANNOTATION_STAGE_LAYOUT;

  return (
    <div className="dial-archive-stage-canvas" aria-hidden="true">
      <div className="dial-archive-stage-canvas__void" />
      <div className="dial-archive-stage-canvas__flare" />
      <StarLayer stars={starfield.far} className="dial-archive-stage-canvas__stars is-far" />
      <StarLayer stars={starfield.mid} className="dial-archive-stage-canvas__stars is-mid" />
      <StarLayer stars={starfield.band} className="dial-archive-stage-canvas__stars is-band" />
      <div className="dial-archive-stage-canvas__horizon">
        <div className="dial-archive-stage-canvas__ground" />
      </div>
      <div className="dial-archive-stage-canvas__evidence">
        {evidenceAssets.slice(0, evidence.length).map((asset, index) => {
          const slot = evidence[index];
          return (
            <figure
              className={`dial-archive-stage-canvas__board is-${slot.id}`}
              style={{
                left: `${slot.leftPercent}%`,
                top: `${slot.topPercent}%`,
                width: slot.width,
                transform: `rotateY(${slot.rotateY}deg)`,
              }}
              key={asset.id}
            >
              <img src={asset.thumbnailUrl} alt="" draggable={false} loading="lazy" />
              <figcaption>
                <span>{slot.code}</span>
                <small>
                  {asset.width} × {asset.height}
                </small>
              </figcaption>
            </figure>
          );
        })}
      </div>
      <div className="dial-archive-stage-canvas__ghost-word">MATERIAL</div>
    </div>
  );
});
