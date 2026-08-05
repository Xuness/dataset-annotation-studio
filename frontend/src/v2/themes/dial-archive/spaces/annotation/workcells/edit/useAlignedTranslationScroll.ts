import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, type RefObject } from "react";

export type TranslationAlignmentSide = "source" | "target";

interface UseAlignedTranslationScrollOptions {
  sourceRootRef: RefObject<HTMLElement | null>;
  targetRootRef: RefObject<HTMLElement | null>;
  alignmentIds: readonly string[];
  layoutKey: string;
  enabled: boolean;
}

interface ScrollSyncPoint {
  from: number;
  to: number;
}

interface ScrollSyncCache {
  layoutKey: string;
  sourceToTarget: ScrollSyncPoint[];
  targetToSource: ScrollSyncPoint[];
}

interface SuppressedScroll {
  side: TranslationAlignmentSide;
  top: number;
}

interface AlignmentVerticalRange {
  top: number;
  bottom: number;
}

interface HighlightScrollAnimation {
  side: TranslationAlignmentSide;
  frameId: number;
  startTop: number;
  targetTop: number;
  startedAt: number | null;
  lastAppliedTop: number;
}

// Keep corresponding clauses near the upper reading third, then interpolate
// between those anchors when source and translation have different line wraps.
const SCROLL_READING_ANCHOR = 0.35;
const SCROLL_POSITION_EPSILON = 1;
const HIGHLIGHT_VISIBILITY_MARGIN = 8;
const HIGHLIGHT_SCROLL_DURATION_MS = 160;
const HIGHLIGHT_SCROLL_MIN_DISTANCE = 4;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

function maximumScrollTop(container: HTMLElement): number {
  return Math.max(0, container.scrollHeight - container.clientHeight);
}

function resolveReadingContainer(root: HTMLElement | null): HTMLElement | null {
  return root?.querySelector<HTMLElement>(".dial-archive-edit-translation__aligned") ?? null;
}

function scrollSyncLayoutKey(source: HTMLElement, target: HTMLElement): string {
  return [
    source.clientWidth,
    source.clientHeight,
    source.scrollHeight,
    target.clientWidth,
    target.clientHeight,
    target.scrollHeight,
  ].join(":");
}

function collectAlignmentCenters(container: HTMLElement): Map<string, number> {
  const containerBounds = container.getBoundingClientRect();
  const centers = new Map<string, number>();
  for (const element of container.querySelectorAll<HTMLElement>("[data-alignment-id]")) {
    const id = element.dataset.alignmentId;
    if (!id) continue;
    const bounds = element.getBoundingClientRect();
    centers.set(
      id,
      bounds.top - containerBounds.top + container.scrollTop + Math.max(bounds.height, 0) / 2,
    );
  }
  return centers;
}

function scrollPositionForCenter(container: HTMLElement, center: number): number {
  return clamp(
    center - container.clientHeight * SCROLL_READING_ANCHOR,
    0,
    maximumScrollTop(container),
  );
}

function buildScrollSyncPoints(
  driver: HTMLElement,
  follower: HTMLElement,
  driverCenters: Map<string, number>,
  followerCenters: Map<string, number>,
): ScrollSyncPoint[] {
  const driverMaximum = maximumScrollTop(driver);
  const followerMaximum = maximumScrollTop(follower);
  const rawPoints: ScrollSyncPoint[] = [
    { from: 0, to: 0 },
    { from: driverMaximum, to: followerMaximum },
  ];

  for (const [id, driverCenter] of driverCenters) {
    const followerCenter = followerCenters.get(id);
    if (followerCenter === undefined) continue;
    rawPoints.push({
      from: scrollPositionForCenter(driver, driverCenter),
      to: scrollPositionForCenter(follower, followerCenter),
    });
  }
  rawPoints.sort((left, right) => left.from - right.from);

  const groupedPoints: Array<{ from: number; targets: number[] }> = [];
  for (const point of rawPoints) {
    const previous = groupedPoints.at(-1);
    if (previous && Math.abs(previous.from - point.from) <= SCROLL_POSITION_EPSILON) {
      previous.targets.push(point.to);
    } else {
      groupedPoints.push({ from: point.from, targets: [point.to] });
    }
  }

  let previousTarget = 0;
  return groupedPoints.map((point) => {
    let target = point.targets.reduce((total, value) => total + value, 0) / point.targets.length;
    if (point.from <= SCROLL_POSITION_EPSILON) {
      target = 0;
    } else if (point.from >= driverMaximum - SCROLL_POSITION_EPSILON) {
      target = followerMaximum;
    }
    target = clamp(Math.max(previousTarget, target), 0, followerMaximum);
    previousTarget = target;
    return { from: point.from, to: target };
  });
}

function buildScrollSyncCache(source: HTMLElement, target: HTMLElement): ScrollSyncCache {
  const sourceCenters = collectAlignmentCenters(source);
  const targetCenters = collectAlignmentCenters(target);
  return {
    layoutKey: scrollSyncLayoutKey(source, target),
    sourceToTarget: buildScrollSyncPoints(source, target, sourceCenters, targetCenters),
    targetToSource: buildScrollSyncPoints(target, source, targetCenters, sourceCenters),
  };
}

function interpolateScrollPosition(points: ScrollSyncPoint[], position: number): number {
  if (!points.length) return 0;
  if (position <= points[0].from) return points[0].to;
  const finalPoint = points.at(-1);
  if (finalPoint && position >= finalPoint.from) return finalPoint.to;

  let lowerIndex = 0;
  let upperIndex = points.length - 1;
  while (upperIndex - lowerIndex > 1) {
    const middleIndex = Math.floor((lowerIndex + upperIndex) / 2);
    if (points[middleIndex].from < position) lowerIndex = middleIndex;
    else upperIndex = middleIndex;
  }
  const lower = points[lowerIndex];
  const upper = points[upperIndex];
  const distance = upper.from - lower.from;
  if (distance <= SCROLL_POSITION_EPSILON) return upper.to;
  const progress = (position - lower.from) / distance;
  return lower.to + (upper.to - lower.to) * progress;
}

function collectAlignmentRange(
  container: HTMLElement,
  alignmentIds: readonly string[],
): AlignmentVerticalRange | null {
  const requestedIds = new Set(alignmentIds);
  const containerBounds = container.getBoundingClientRect();
  let top = Number.POSITIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;

  for (const element of container.querySelectorAll<HTMLElement>("[data-alignment-id]")) {
    if (!element.dataset.alignmentId || !requestedIds.has(element.dataset.alignmentId)) continue;
    const bounds = element.getBoundingClientRect();
    top = Math.min(top, bounds.top - containerBounds.top + container.scrollTop);
    bottom = Math.max(bottom, bounds.bottom - containerBounds.top + container.scrollTop);
  }
  return Number.isFinite(top) && Number.isFinite(bottom) ? { top, bottom } : null;
}

function alignmentRangeIsVisible(container: HTMLElement, range: AlignmentVerticalRange): boolean {
  const margin = Math.min(HIGHLIGHT_VISIBILITY_MARGIN, container.clientHeight / 4);
  const viewportTop = container.scrollTop + margin;
  const viewportBottom = container.scrollTop + container.clientHeight - margin;
  if (range.bottom - range.top > viewportBottom - viewportTop) {
    return range.bottom > viewportTop && range.top < viewportBottom;
  }
  return range.top >= viewportTop && range.bottom <= viewportBottom;
}

function scrollTopToRevealAlignment(
  container: HTMLElement,
  range: AlignmentVerticalRange,
): number | null {
  if (alignmentRangeIsVisible(container, range)) return null;
  const margin = Math.min(HIGHLIGHT_VISIBILITY_MARGIN, container.clientHeight / 4);
  const viewportTop = container.scrollTop + margin;
  const viewportBottom = container.scrollTop + container.clientHeight - margin;
  const nextTop =
    range.top < viewportTop
      ? range.top - margin
      : range.bottom > viewportBottom
        ? range.bottom - container.clientHeight + margin
        : container.scrollTop;
  return clamp(nextTop, 0, maximumScrollTop(container));
}

function prefersReducedMotion(): boolean {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

function easeOutCubic(progress: number): number {
  return 1 - (1 - progress) ** 3;
}

export function useAlignedTranslationScroll({
  sourceRootRef,
  targetRootRef,
  alignmentIds,
  layoutKey,
  enabled,
}: UseAlignedTranslationScrollOptions) {
  const scrollSyncCacheRef = useRef<ScrollSyncCache | null>(null);
  const suppressedScrollRef = useRef<SuppressedScroll | null>(null);
  const highlightSideRef = useRef<TranslationAlignmentSide | null>(null);
  const highlightScrollAnimationRef = useRef<HighlightScrollAnimation | null>(null);
  const alignmentKey = useMemo(() => alignmentIds.join("\u0000"), [alignmentIds]);
  const alignmentIdsRef = useRef(alignmentIds);
  alignmentIdsRef.current = alignmentIds;

  const cancelHighlightScrollAnimation = useCallback(() => {
    const animation = highlightScrollAnimationRef.current;
    if (animation) window.cancelAnimationFrame(animation.frameId);
    highlightScrollAnimationRef.current = null;
  }, []);

  const applyProgrammaticScroll = useCallback(
    (side: TranslationAlignmentSide, container: HTMLElement, top: number) => {
      suppressedScrollRef.current = { side, top };
      container.scrollTop = top;
    },
    [],
  );

  const animateHighlightScroll = useCallback(
    (side: TranslationAlignmentSide, container: HTMLElement, targetTop: number) => {
      cancelHighlightScrollAnimation();
      const startTop = container.scrollTop;
      if (
        prefersReducedMotion() ||
        typeof window.requestAnimationFrame !== "function" ||
        Math.abs(targetTop - startTop) < HIGHLIGHT_SCROLL_MIN_DISTANCE
      ) {
        applyProgrammaticScroll(side, container, targetTop);
        return;
      }

      const animation: HighlightScrollAnimation = {
        side,
        frameId: 0,
        startTop,
        targetTop,
        startedAt: null,
        lastAppliedTop: startTop,
      };
      const step = (timestamp: number) => {
        if (highlightScrollAnimationRef.current !== animation) return;
        animation.startedAt ??= timestamp;
        const progress = Math.min(
          1,
          (timestamp - animation.startedAt) / HIGHLIGHT_SCROLL_DURATION_MS,
        );
        const nextTop =
          animation.startTop + (animation.targetTop - animation.startTop) * easeOutCubic(progress);
        animation.lastAppliedTop = nextTop;
        applyProgrammaticScroll(side, container, nextTop);
        if (progress < 1) animation.frameId = window.requestAnimationFrame(step);
        else highlightScrollAnimationRef.current = null;
      };

      highlightScrollAnimationRef.current = animation;
      animation.frameId = window.requestAnimationFrame(step);
    },
    [applyProgrammaticScroll, cancelHighlightScrollAnimation],
  );

  const handleAlignedScroll = useCallback(
    (side: TranslationAlignmentSide) => {
      if (!enabled) return;
      const source = resolveReadingContainer(sourceRootRef.current);
      const target = resolveReadingContainer(targetRootRef.current);
      if (!source || !target) return;
      const driver = side === "source" ? source : target;
      const follower = side === "source" ? target : source;

      const suppressed = suppressedScrollRef.current;
      if (suppressed?.side === side) {
        suppressedScrollRef.current = null;
        if (Math.abs(driver.scrollTop - suppressed.top) <= SCROLL_POSITION_EPSILON) return;
      }

      const animation = highlightScrollAnimationRef.current;
      if (
        animation?.side === side &&
        Math.abs(driver.scrollTop - animation.lastAppliedTop) <= SCROLL_POSITION_EPSILON
      ) {
        return;
      }
      cancelHighlightScrollAnimation();

      const currentLayoutKey = scrollSyncLayoutKey(source, target);
      let cache = scrollSyncCacheRef.current;
      if (!cache || cache.layoutKey !== currentLayoutKey) {
        cache = buildScrollSyncCache(source, target);
        scrollSyncCacheRef.current = cache;
      }
      const points = side === "source" ? cache.sourceToTarget : cache.targetToSource;
      const nextTop = clamp(
        interpolateScrollPosition(points, driver.scrollTop),
        0,
        maximumScrollTop(follower),
      );
      if (Math.abs(follower.scrollTop - nextTop) <= SCROLL_POSITION_EPSILON) return;

      suppressedScrollRef.current = {
        side: side === "source" ? "target" : "source",
        top: nextTop,
      };
      follower.scrollTop = nextTop;
    },
    [cancelHighlightScrollAnimation, enabled, sourceRootRef, targetRootRef],
  );

  useEffect(() => {
    cancelHighlightScrollAnimation();
    scrollSyncCacheRef.current = null;
    suppressedScrollRef.current = null;
    highlightSideRef.current = null;
  }, [cancelHighlightScrollAnimation, enabled, layoutKey]);

  useEffect(
    () => () => {
      cancelHighlightScrollAnimation();
    },
    [cancelHighlightScrollAnimation],
  );

  useEffect(() => {
    if (!enabled) return;
    const source = resolveReadingContainer(sourceRootRef.current);
    const target = resolveReadingContainer(targetRootRef.current);
    if (!source || !target) return;
    const fromSource = () => handleAlignedScroll("source");
    const fromTarget = () => handleAlignedScroll("target");
    source.addEventListener("scroll", fromSource, { passive: true });
    target.addEventListener("scroll", fromTarget, { passive: true });
    return () => {
      source.removeEventListener("scroll", fromSource);
      target.removeEventListener("scroll", fromTarget);
    };
  }, [enabled, handleAlignedScroll, layoutKey, sourceRootRef, targetRootRef]);

  useLayoutEffect(() => {
    cancelHighlightScrollAnimation();
    const currentAlignmentIds = alignmentIdsRef.current;
    if (!enabled || !currentAlignmentIds.length) return;
    const highlightSide = highlightSideRef.current;
    const source = resolveReadingContainer(sourceRootRef.current);
    const target = resolveReadingContainer(targetRootRef.current);
    if (!highlightSide || !source || !target) return;

    const sourceRange = collectAlignmentRange(source, currentAlignmentIds);
    const targetRange = collectAlignmentRange(target, currentAlignmentIds);
    if (!sourceRange || !targetRange) return;
    const sourceVisible = alignmentRangeIsVisible(source, sourceRange);
    const targetVisible = alignmentRangeIsVisible(target, targetRange);
    if (sourceVisible && targetVisible) return;

    const counterpartSide: TranslationAlignmentSide =
      highlightSide === "source" ? "target" : "source";
    const counterpart = counterpartSide === "source" ? source : target;
    const counterpartRange = counterpartSide === "source" ? sourceRange : targetRange;
    if (counterpartSide === "source" ? sourceVisible : targetVisible) return;
    const nextTop = scrollTopToRevealAlignment(counterpart, counterpartRange);
    if (nextTop === null || Math.abs(counterpart.scrollTop - nextTop) <= SCROLL_POSITION_EPSILON) {
      return;
    }

    animateHighlightScroll(counterpartSide, counterpart, nextTop);
  }, [
    alignmentKey,
    animateHighlightScroll,
    cancelHighlightScrollAnimation,
    enabled,
    layoutKey,
    sourceRootRef,
    targetRootRef,
  ]);

  return useCallback((side: TranslationAlignmentSide) => {
    highlightSideRef.current = side;
  }, []);
}
