import { memo, useEffect, useRef, type WheelEventHandler } from "react";

import type { AnnotationStageSequence } from "../../../../../pages/spaces/spacePageModel";
import { ANNOTATION_STAGE_FILM_STEP, ANNOTATION_STAGE_LAYOUT } from "./model/annotationStageLayout";

/**
 * 素材胶片轨道：当前项锁定在展台竖轴上，两端渐隐（CSS mask）。
 * 只渲染当前索引附近的窗口；接近已装载末尾时请求下一页。
 * 当前对象使用黑白身份框，批量范围使用黄色咬合标记，两套语义分离。
 */

interface AnnotationFilmstripProps {
  sequence: AnnotationStageSequence;
  currentIndex: number;
  checkedAssetIds: readonly string[];
  onSelectAsset(assetId: string): void;
  onStepAsset(offset: number): void;
  onToggleAssetChecked(assetId: string): void;
}

export const AnnotationFilmstrip = memo(function AnnotationFilmstrip({
  sequence,
  currentIndex,
  checkedAssetIds,
  onSelectAsset,
  onStepAsset,
  onToggleAssetChecked,
}: AnnotationFilmstripProps) {
  const { filmstrip } = ANNOTATION_STAGE_LAYOUT;
  const wheelIntentRef = useRef(0);
  const wheelResetTimerRef = useRef(0);
  const { assets, loadedCount, totalCount, hasMore, fetchingMore, loadError, loadMore } = sequence;

  useEffect(() => {
    if (!hasMore || fetchingMore || loadError) return;
    if (loadedCount - currentIndex <= filmstrip.loadMoreThreshold) loadMore();
  }, [
    currentIndex,
    fetchingMore,
    filmstrip.loadMoreThreshold,
    hasMore,
    loadError,
    loadMore,
    loadedCount,
  ]);
  useEffect(
    () => () => {
      window.clearTimeout(wheelResetTimerRef.current);
    },
    [],
  );

  const anchor = Math.max(currentIndex, 0);
  const windowStart = Math.max(0, anchor - filmstrip.windowRadius);
  const windowEnd = Math.min(assets.length, anchor + filmstrip.windowRadius + 1);
  const checked = new Set(checkedAssetIds);

  const handleWheel: WheelEventHandler<HTMLDivElement> = (event) => {
    const dominant = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
    if (dominant === 0) return;
    event.preventDefault();
    event.stopPropagation();
    wheelIntentRef.current += dominant;
    let steps = 0;
    while (Math.abs(wheelIntentRef.current) >= filmstrip.wheelStepThreshold && steps < 6) {
      const direction = wheelIntentRef.current > 0 ? 1 : -1;
      onStepAsset(direction);
      wheelIntentRef.current -= direction * filmstrip.wheelStepThreshold;
      steps += 1;
    }
    window.clearTimeout(wheelResetTimerRef.current);
    wheelResetTimerRef.current = window.setTimeout(() => {
      wheelIntentRef.current = 0;
    }, filmstrip.wheelIntentResetMs);
  };

  return (
    <nav
      className="dial-archive-stage-filmstrip"
      aria-label="素材胶片轨道"
      data-stage-camera-lock
      onWheel={handleWheel}
    >
      <i className="dial-archive-stage-filmstrip__rail is-top" aria-hidden="true" />
      <i className="dial-archive-stage-filmstrip__rail is-bottom" aria-hidden="true" />
      <div
        className="dial-archive-stage-filmstrip__track"
        style={{ transform: `translateX(${-anchor * ANNOTATION_STAGE_FILM_STEP}px)` }}
      >
        {assets.slice(windowStart, windowEnd).map((asset, offset) => {
          const index = windowStart + offset;
          const current = index === currentIndex;
          const inRange = checked.has(asset.id);
          return (
            <button
              className={`dial-archive-stage-filmstrip__cell${current ? " is-current" : ""}${inRange ? " is-ranged" : ""}`}
              type="button"
              style={{ left: index * ANNOTATION_STAGE_FILM_STEP }}
              aria-label={`查看素材 ${asset.filename}`}
              aria-current={current || undefined}
              onClick={(event) => {
                if (event.altKey) onToggleAssetChecked(asset.id);
                else onSelectAsset(asset.id);
              }}
              key={asset.id}
            >
              <img src={asset.thumbnailUrl} alt="" draggable={false} loading="lazy" />
              <span className="dial-archive-stage-filmstrip__cell-index" aria-hidden="true">
                {index + 1}
              </span>
              {inRange ? (
                <span className="dial-archive-stage-filmstrip__range-bite" aria-hidden="true" />
              ) : null}
            </button>
          );
        })}
      </div>
      <footer className="dial-archive-stage-filmstrip__foot">
        <span>
          {checkedAssetIds.length > 0 ? `${checkedAssetIds.length} SELECTED / ` : ""}
          {totalCount} MATERIAL
        </span>
        {loadError && hasMore ? (
          <button type="button" onClick={loadMore}>
            RETRY SEQUENCE →
          </button>
        ) : (
          <span>{fetchingMore ? "LOADING SEQUENCE…" : "ALT + CLICK // TOGGLE RANGE"}</span>
        )}
      </footer>
    </nav>
  );
});
