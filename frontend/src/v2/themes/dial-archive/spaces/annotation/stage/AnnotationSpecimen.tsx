import { memo, useEffect, useState } from "react";

import type { AnnotationStageAsset } from "../../../../../pages/spaces/spacePageModel";
import {
  ANNOTATION_STAGE_LAYOUT,
  createStageArcPath,
  createStageRingTicks,
} from "./model/annotationStageLayout";
import { readAssetChannelStates } from "./model/annotationStagePresentation";

/**
 * 素材展台（Z1 主视觉）：真彩主图 + 仪器框架。
 * 图片保持真实颜色与比例；弧环、刻度、注册角与基线标尺负责把视线
 * 汇聚到当前对象上，几何全部来自布局模型。
 */

const RING_TICKS = createStageRingTicks();

function InstrumentRing() {
  const { instrument } = ANNOTATION_STAGE_LAYOUT;
  return (
    <svg
      className="dial-archive-stage-specimen__ring"
      viewBox={`0 0 ${instrument.viewBox.width} ${instrument.viewBox.height}`}
      aria-hidden="true"
    >
      <g className="dial-archive-stage-specimen__ring-rotor">
        {RING_TICKS.map((tick, index) => (
          <line
            className={tick.major ? "is-major" : undefined}
            x1={tick.x1}
            y1={tick.y1}
            x2={tick.x2}
            y2={tick.y2}
            key={index}
          />
        ))}
      </g>
      {instrument.arcs.map((arc, index) => (
        <path
          className="dial-archive-stage-specimen__ring-arc"
          d={createStageArcPath(arc)}
          key={index}
        />
      ))}
    </svg>
  );
}

interface AnnotationSpecimenProps {
  asset: AnnotationStageAsset | null;
  checked: boolean;
  onOpenDefaultWorkcell(): void;
}

export const AnnotationSpecimen = memo(function AnnotationSpecimen({
  asset,
  checked,
  onOpenDefaultWorkcell,
}: AnnotationSpecimenProps) {
  const [failedAssetId, setFailedAssetId] = useState<string | null>(null);
  useEffect(() => setFailedAssetId(null), [asset?.id]);
  const failed = asset != null && failedAssetId === asset.id;
  const channelReadings = readAssetChannelStates(asset);

  return (
    <section className="dial-archive-stage-specimen" aria-label="当前素材展台">
      <InstrumentRing />
      <div className={`dial-archive-stage-specimen__plinth${checked ? " is-checked" : ""}`}>
        <span className="dial-archive-stage-specimen__corner is-tl" aria-hidden="true" />
        <span className="dial-archive-stage-specimen__corner is-tr" aria-hidden="true" />
        <span className="dial-archive-stage-specimen__corner is-bl" aria-hidden="true" />
        <span className="dial-archive-stage-specimen__corner is-br" aria-hidden="true" />
        <span className="dial-archive-stage-specimen__measure" aria-hidden="true" />
        {asset && !failed ? (
          <button
            className="dial-archive-stage-specimen__frame"
            type="button"
            aria-label={`打开素材 ${asset.filename}`}
            onClick={onOpenDefaultWorkcell}
          >
            <img
              src={asset.imageUrl}
              alt={asset.filename}
              draggable={false}
              onError={() => setFailedAssetId(asset.id)}
            />
          </button>
        ) : (
          <div className="dial-archive-stage-specimen__frame is-empty" role="status">
            {asset && failed ? (
              <>
                <b>IMAGE UNAVAILABLE</b>
                <span>{asset.relativePath}</span>
              </>
            ) : (
              <>
                <b>NO MATERIAL</b>
                <span>当前序列没有可展示的素材</span>
              </>
            )}
          </div>
        )}
        {checked ? (
          <span className="dial-archive-stage-specimen__range-tag" aria-hidden="true">
            IN RANGE
          </span>
        ) : null}
      </div>
      <footer className="dial-archive-stage-specimen__baseline" aria-hidden="true">
        <i className="dial-archive-stage-specimen__baseline-rule" />
        <div className="dial-archive-stage-specimen__readings">
          <span className="dial-archive-stage-specimen__path">{asset?.relativePath ?? "—"}</span>
          <span>{asset ? `${asset.width} × ${asset.height}` : "— × —"}</span>
          <span className="dial-archive-stage-specimen__channels">
            {channelReadings.map((reading) => (
              <em className={`is-${reading.state}`} key={reading.lane}>
                {reading.code}.{reading.stateCode}
              </em>
            ))}
          </span>
        </div>
      </footer>
    </section>
  );
});
