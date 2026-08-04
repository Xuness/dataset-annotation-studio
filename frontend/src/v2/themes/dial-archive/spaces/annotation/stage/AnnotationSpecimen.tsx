import { memo, useEffect, useRef, useState, type KeyboardEventHandler } from "react";

import type { AnnotationStageAsset } from "../../../../../pages/spaces/spacePageModel";
import {
  ANNOTATION_STAGE_LAYOUT,
  createStageArcPath,
  createStageRingTicks,
} from "./model/annotationStageLayout";
import { readAssetChannelStates } from "./model/annotationStagePresentation";
import type { StageAssetWalk } from "./hooks/useStageAssetNavigation";
import { useSpecimenViewport } from "./hooks/useSpecimenViewport";

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
  reducedMotion: boolean;
  walk: StageAssetWalk;
  onOpenDefaultWorkcell(): void;
}

export const AnnotationSpecimen = memo(function AnnotationSpecimen({
  asset,
  checked,
  reducedMotion,
  walk,
  onOpenDefaultWorkcell,
}: AnnotationSpecimenProps) {
  const [failedAssetId, setFailedAssetId] = useState<string | null>(null);
  const openTimerRef = useRef(0);
  const viewport = useSpecimenViewport({ asset, reducedMotion });
  useEffect(() => {
    setFailedAssetId(null);
    window.clearTimeout(openTimerRef.current);
  }, [asset?.id]);
  useEffect(
    () => () => {
      window.clearTimeout(openTimerRef.current);
    },
    [],
  );
  const failed = asset != null && failedAssetId === asset.id;
  const channelReadings = readAssetChannelStates(asset);
  const walkDirection = walk.direction > 0 ? "forward" : "backward";

  const openWithClickDelay = () => {
    if (viewport.consumeSuppressedClick()) return;
    window.clearTimeout(openTimerRef.current);
    openTimerRef.current = window.setTimeout(
      onOpenDefaultWorkcell,
      ANNOTATION_STAGE_LAYOUT.viewport.openDelayMs,
    );
  };
  const handleDoubleClick = () => {
    window.clearTimeout(openTimerRef.current);
    viewport.toggleActual();
  };
  const handleViewportKeyDown: KeyboardEventHandler<HTMLDivElement> = (event) => {
    viewport.onKeyDown(event);
    if (event.defaultPrevented) return;
    if (event.key === "Enter") {
      event.preventDefault();
      event.stopPropagation();
      onOpenDefaultWorkcell();
    }
  };

  return (
    <section
      className="dial-archive-stage-specimen"
      aria-label="当前素材展台"
      data-stage-camera-lock
    >
      <InstrumentRing />
      <div className="dial-archive-stage-specimen__assembly">
        <span className="dial-archive-stage-specimen__rear is-register" aria-hidden="true" />
        <span className="dial-archive-stage-specimen__rear is-signal" aria-hidden="true" />
        <div className={`dial-archive-stage-specimen__plinth${checked ? " is-checked" : ""}`}>
          <span className="dial-archive-stage-specimen__corner is-tl" aria-hidden="true" />
          <span className="dial-archive-stage-specimen__corner is-br" aria-hidden="true" />
          <span className="dial-archive-stage-specimen__measure" aria-hidden="true" />
          <span className="dial-archive-stage-specimen__index-rail" aria-hidden="true">
            SPECIMEN // TRUE COLOR
          </span>
          {asset && !failed ? (
            <div
              className={`dial-archive-stage-specimen__frame${walk.active ? ` is-walking-${walkDirection}` : ""}`}
              ref={viewport.viewportRef}
              role="group"
              tabIndex={0}
              aria-label={`素材 ${asset.filename} 查看器`}
              onClick={openWithClickDelay}
              onDoubleClick={handleDoubleClick}
              onKeyDown={handleViewportKeyDown}
              onPointerDown={viewport.onPointerDown}
              onPointerMove={viewport.onPointerMove}
              onPointerUp={viewport.onPointerUp}
              onPointerCancel={viewport.onPointerCancel}
              onWheel={viewport.onWheel}
            >
              {walk.active && walk.previousAsset ? (
                <div
                  className="dial-archive-stage-specimen__walk-layer is-outgoing"
                  aria-hidden="true"
                  key={`outgoing-${walk.serial}`}
                >
                  <img src={walk.previousAsset.imageUrl} alt="" draggable={false} />
                </div>
              ) : null}
              <div
                className="dial-archive-stage-specimen__walk-layer is-current"
                key={`${asset.id}-${walk.serial}`}
              >
                <div className="dial-archive-stage-specimen__surface" ref={viewport.surfaceRef}>
                  <img
                    ref={viewport.imageRef}
                    src={asset.imageUrl}
                    alt={asset.filename}
                    draggable={false}
                    onError={() => setFailedAssetId(asset.id)}
                  />
                </div>
              </div>
            </div>
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
          {asset && !failed ? (
            <div
              className="dial-archive-stage-specimen__viewport-tools"
              role="group"
              aria-label="图片观察工具"
            >
              <button type="button" onClick={() => viewport.fit()}>
                FIT
              </button>
              <button type="button" onClick={() => viewport.actual()}>
                1:1
              </button>
              <i aria-hidden="true" />
              <button type="button" aria-label="缩小图片" onClick={viewport.zoomOut}>
                −
              </button>
              <output ref={viewport.scaleReadoutRef} aria-label="图片缩放比例">
                100%
              </output>
              <button type="button" aria-label="放大图片" onClick={viewport.zoomIn}>
                +
              </button>
              <button
                className="is-edit"
                type="button"
                aria-label="打开标注编辑工作间"
                onClick={onOpenDefaultWorkcell}
              >
                EDIT ↗
              </button>
            </div>
          ) : null}
          {checked ? (
            <span className="dial-archive-stage-specimen__range-tag" aria-hidden="true">
              IN RANGE
            </span>
          ) : null}
        </div>
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
