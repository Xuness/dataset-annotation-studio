import { memo } from "react";

import type { AnnotationStageAsset } from "../../../../../pages/spaces/spacePageModel";
import type { StageAssetWalk } from "./hooks/useStageAssetNavigation";
import { formatStageByteSize, formatStageIndex } from "./model/annotationStageLayout";
import { readAssetChannelStates } from "./model/annotationStagePresentation";

/**
 * 固定在观察者平面的素材身份读数。
 * 它不跟随后方工作间做 3D 旋转，保证文件身份与通道状态始终清晰可读。
 */
interface AnnotationStageReadoutProps {
  asset: AnnotationStageAsset | null;
  currentIndex: number;
  walk: StageAssetWalk;
}

export const AnnotationStageReadout = memo(function AnnotationStageReadout({
  asset,
  currentIndex,
  walk,
}: AnnotationStageReadoutProps) {
  const channelReadings = readAssetChannelStates(asset);
  const walkClass = walk.active ? ` is-walking-${walk.direction > 0 ? "forward" : "backward"}` : "";

  return (
    <aside
      className="dial-archive-stage-readout"
      aria-label="当前素材身份读数"
      data-stage-camera-lock
    >
      <span className="dial-archive-stage-readout__eyebrow">SPECIMEN // CURRENT OBJECT</span>
      <header className={`dial-archive-stage-readout__identity${walkClass}`}>
        {walk.active && walk.previousAsset ? (
          <div
            className="dial-archive-stage-readout__layer is-outgoing"
            aria-hidden="true"
            key={`previous-${walk.serial}`}
          >
            <div className="dial-archive-stage-readout__ordinal">
              {formatStageIndex(walk.previousIndex)}
            </div>
            <p>{walk.previousAsset.filename}</p>
          </div>
        ) : null}
        <div
          className="dial-archive-stage-readout__layer is-current"
          key={`${asset?.id ?? "empty"}-${walk.serial}`}
        >
          <div className="dial-archive-stage-readout__ordinal" aria-hidden="true">
            {formatStageIndex(currentIndex)}
          </div>
          <p title={asset?.filename}>{asset?.filename ?? "NO MATERIAL LOADED"}</p>
        </div>
      </header>

      <dl className={`dial-archive-stage-readout__ledger${walkClass}`}>
        <div>
          <dt>FORMAT</dt>
          <dd>{asset ? asset.suffix.replace(".", "").toUpperCase() : "—"}</dd>
        </div>
        <div>
          <dt>SIZE</dt>
          <dd>{asset ? formatStageByteSize(asset.byteSize) : "—"}</dd>
        </div>
        <div className="is-channels">
          <dt>CHANNELS</dt>
          <dd>
            {channelReadings.map((reading) => (
              <em className={`is-${reading.state}`} key={reading.lane}>
                {reading.code}.{reading.stateCode}
              </em>
            ))}
          </dd>
        </div>
      </dl>
    </aside>
  );
});
