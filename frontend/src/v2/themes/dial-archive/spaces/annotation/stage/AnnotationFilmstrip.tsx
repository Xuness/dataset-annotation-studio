import { memo, useEffect, useLayoutEffect, useRef, useState, type WheelEventHandler } from "react";

import type {
  AnnotationStageScope,
  AnnotationStageSequence,
} from "../../../../../pages/spaces/spacePageModel";
import {
  ANNOTATION_STAGE_FILM_STEP,
  ANNOTATION_STAGE_LAYOUT,
  resolveFilmstripTrackOffset,
} from "./model/annotationStageLayout";

/**
 * 素材胶片轨道：首次装载时将当前项放到展台轴线，此后选中与轨道视窗解耦。
 * 可见项被点击后保持原位，只有越过两端渐隐区时才做最短补位。
 * 只渲染轨道视窗与当前索引附近的窗口；接近已装载末尾时请求下一页。
 * 当前对象使用黑白身份框，批量范围使用黄色咬合标记，两套语义分离。
 */

interface AnnotationFilmstripProps {
  sequence: AnnotationStageSequence;
  scope: AnnotationStageScope;
  currentIndex: number;
  checkedAssetIds: readonly string[];
  onSelectAsset(assetId: string): void;
  onStepAsset(offset: number): void;
  onToggleAssetChecked(assetId: string): void;
}

export const AnnotationFilmstrip = memo(function AnnotationFilmstrip({
  sequence,
  scope,
  currentIndex,
  checkedAssetIds,
  onSelectAsset,
  onStepAsset,
  onToggleAssetChecked,
}: AnnotationFilmstripProps) {
  const { filmstrip } = ANNOTATION_STAGE_LAYOUT;
  const navRef = useRef<HTMLElement>(null);
  const wheelIntentRef = useRef(0);
  const wheelResetTimerRef = useRef(0);
  const sequenceIdentityRef = useRef<string | null>(null);
  const preserveTrackForIndexRef = useRef<number | null>(null);
  const trackOffsetRef = useRef(0);
  const [trackOffset, setTrackOffset] = useState(0);
  const [viewportRevision, setViewportRevision] = useState(0);
  const { assets, loadedCount, totalCount, hasMore, fetchingMore, loadError, loadMore } = sequence;
  const sequenceIdentity = assets[0]?.id ?? null;

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
  useEffect(() => {
    const updateViewport = () => setViewportRevision((revision) => revision + 1);
    window.addEventListener("resize", updateViewport);
    return () => window.removeEventListener("resize", updateViewport);
  }, []);

  useLayoutEffect(() => {
    if (!sequenceIdentity || currentIndex < 0) {
      if (sequenceIdentityRef.current !== null) {
        sequenceIdentityRef.current = null;
        trackOffsetRef.current = 0;
        setTrackOffset(0);
      }
      return;
    }

    if (sequenceIdentityRef.current !== sequenceIdentity) {
      sequenceIdentityRef.current = sequenceIdentity;
      preserveTrackForIndexRef.current = null;
      const centeredOffset = -currentIndex * ANNOTATION_STAGE_FILM_STEP;
      trackOffsetRef.current = centeredOffset;
      setTrackOffset(centeredOffset);
      return;
    }

    const preserveSelectedPosition = preserveTrackForIndexRef.current === currentIndex;
    preserveTrackForIndexRef.current = null;
    if (preserveSelectedPosition) return;

    const viewport = navRef.current;
    const currentCell = viewport?.querySelector<HTMLElement>(`[data-film-index="${currentIndex}"]`);
    if (!viewport || !currentCell) return;
    const viewportRect = viewport.getBoundingClientRect();
    const cellRect = currentCell.getBoundingClientRect();
    const nextOffset = resolveFilmstripTrackOffset({
      currentOffset: trackOffsetRef.current,
      viewportLeft: viewportRect.left,
      viewportWidth: viewportRect.width,
      cellLeft: cellRect.left,
      cellRight: cellRect.right,
    });
    if (Math.abs(nextOffset - trackOffsetRef.current) >= 0.5) {
      trackOffsetRef.current = nextOffset;
      setTrackOffset(nextOffset);
    }
  }, [currentIndex, sequenceIdentity, viewportRevision]);

  const focusIndex = Math.max(currentIndex, 0);
  const viewportAnchor = Math.max(0, Math.round(-trackOffset / ANNOTATION_STAGE_FILM_STEP));
  const keepBothWindows = Math.abs(focusIndex - viewportAnchor) <= filmstrip.windowRadius * 2;
  const renderStart = keepBothWindows ? Math.min(focusIndex, viewportAnchor) : focusIndex;
  const renderEnd = keepBothWindows ? Math.max(focusIndex, viewportAnchor) : focusIndex;
  const progressSlots = ANNOTATION_STAGE_LAYOUT.console.progressSlots;
  const progressFilled =
    totalCount > 0 && currentIndex >= 0
      ? Math.min(progressSlots, Math.floor(((currentIndex + 1) / totalCount) * progressSlots) + 1)
      : 0;
  const windowStart = Math.max(0, renderStart - filmstrip.windowRadius);
  const windowEnd = Math.min(assets.length, renderEnd + filmstrip.windowRadius + 1);
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
      ref={navRef}
      aria-label="素材胶片轨道"
      data-stage-camera-lock
      onWheel={handleWheel}
    >
      <i className="dial-archive-stage-filmstrip__rail is-top" aria-hidden="true" />
      <i className="dial-archive-stage-filmstrip__rail is-bottom" aria-hidden="true" />
      <div
        className="dial-archive-stage-filmstrip__scope"
        role="search"
        onWheel={(event) => event.stopPropagation()}
      >
        <label>
          <span>FIND</span>
          <input
            type="search"
            value={scope.search}
            placeholder="文件名 / 相对路径"
            aria-label="搜索素材"
            onChange={(event) => scope.setSearch(event.target.value)}
          />
        </label>
        <label>
          <span>STATE</span>
          <select
            value={scope.filter}
            aria-label="筛选素材状态"
            onChange={(event) =>
              scope.setFilter(event.target.value as AnnotationStageScope["filter"])
            }
          >
            {scope.filters.map((filter) => (
              <option value={filter.id} key={filter.id}>
                {filter.label}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          disabled={!totalCount || scope.selectingAll}
          onClick={() => void scope.selectAllFiltered()}
        >
          {scope.selectingAll ? "READING" : "SELECT FILTER"}
        </button>
        <button type="button" disabled={!checkedAssetIds.length} onClick={scope.clearChecked}>
          CLEAR
        </button>
      </div>
      <div
        className="dial-archive-stage-filmstrip__track"
        style={{ transform: `translateX(${trackOffset}px)` }}
      >
        {assets.slice(windowStart, windowEnd).map((asset, offset) => {
          const index = windowStart + offset;
          const current = index === currentIndex;
          const inRange = checked.has(asset.id);
          return (
            <button
              className={`dial-archive-stage-filmstrip__cell${current ? " is-current" : ""}${inRange ? " is-ranged" : ""}`}
              type="button"
              data-film-index={index}
              style={{ left: index * ANNOTATION_STAGE_FILM_STEP }}
              aria-label={`查看素材 ${asset.filename}`}
              aria-current={current || undefined}
              onClick={(event) => {
                if (event.shiftKey) scope.toggleRangeTo(asset.id);
                else if (event.altKey) onToggleAssetChecked(asset.id);
                else {
                  preserveTrackForIndexRef.current = index;
                  onSelectAsset(asset.id);
                }
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
      <div className="dial-archive-stage-filmstrip__pager" role="group" aria-label="素材序列导航">
        <button
          type="button"
          aria-label="上一张素材"
          disabled={currentIndex <= 0}
          onClick={() => onStepAsset(-1)}
        >
          ‹
        </button>
        <output>
          <em>{currentIndex >= 0 ? currentIndex + 1 : "—"}</em>
          <span> / {totalCount || "—"}</span>
        </output>
        <button
          type="button"
          aria-label="下一张素材"
          disabled={totalCount === 0 || currentIndex >= totalCount - 1}
          onClick={() => onStepAsset(1)}
        >
          ›
        </button>
        <span className="dial-archive-stage-filmstrip__progress" aria-hidden="true">
          {Array.from({ length: progressSlots }, (_, index) => (
            <i className={index < progressFilled ? "is-filled" : undefined} key={index} />
          ))}
        </span>
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
          <span>
            {scope.actionError ??
              (fetchingMore
                ? "LOADING SEQUENCE…"
                : "SHIFT + CLICK // EXTEND RANGE · ALT + CLICK // TOGGLE")}
          </span>
        )}
      </footer>
    </nav>
  );
});
