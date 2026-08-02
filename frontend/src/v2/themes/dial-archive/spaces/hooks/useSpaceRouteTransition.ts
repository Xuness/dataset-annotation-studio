import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

import { HOME_SPACES, type HomeSpaceId } from "../../../../navigation/spaceRegistry";

const ROUTE_COMMIT_MS = 190;
const ROUTE_FINISH_MS = 720;

interface RouteState {
  active: boolean;
  direction: -1 | 1;
  intentSpaceId: HomeSpaceId;
  version: number;
}

interface UseSpaceRouteTransitionOptions {
  currentSpaceId: HomeSpaceId;
  reducedMotion: boolean;
  pageRef: RefObject<HTMLElement | null>;
  scrollRef: RefObject<HTMLElement | null>;
  onNavigateSpace(spaceId: HomeSpaceId): void;
}

function spaceIndex(spaceId: HomeSpaceId): number {
  return HOME_SPACES.findIndex((space) => space.id === spaceId);
}

function cancelAnimation(animation: Animation | null): void {
  try {
    animation?.cancel();
  } catch {
    // A browser may already have detached the animated route subtree.
  }
}

export function useSpaceRouteTransition({
  currentSpaceId,
  reducedMotion,
  pageRef,
  scrollRef,
  onNavigateSpace,
}: UseSpaceRouteTransitionOptions) {
  const [route, setRoute] = useState<RouteState>({
    active: false,
    direction: 1,
    intentSpaceId: currentSpaceId,
    version: 0,
  });
  const routeVersionRef = useRef(0);
  const targetSpaceRef = useRef<HomeSpaceId | null>(null);
  const timersRef = useRef<number[]>([]);
  const shellAnimationRef = useRef<Animation | null>(null);
  const entryAnimationsRef = useRef<Animation[]>([]);
  const navigateRef = useRef(onNavigateSpace);
  navigateRef.current = onNavigateSpace;

  const clearAnimations = useCallback(() => {
    cancelAnimation(shellAnimationRef.current);
    shellAnimationRef.current = null;
    entryAnimationsRef.current.forEach((animation) => cancelAnimation(animation));
    entryAnimationsRef.current = [];
  }, []);

  const clearTimers = useCallback(() => {
    timersRef.current.forEach((timer) => window.clearTimeout(timer));
    timersRef.current = [];
  }, []);

  useEffect(
    () => () => {
      clearTimers();
      clearAnimations();
    },
    [clearAnimations, clearTimers],
  );

  useEffect(() => {
    const targetSpaceId = targetSpaceRef.current;
    if (!targetSpaceId || targetSpaceId !== currentSpaceId) {
      if (!route.active) setRoute((current) => ({ ...current, intentSpaceId: currentSpaceId }));
      return;
    }

    scrollRef.current?.scrollTo({ top: 0, behavior: "auto" });
    if (reducedMotion) return;
    const page = pageRef.current;
    if (!page || typeof page.animate !== "function") return;

    clearAnimations();
    const direction = route.direction;
    const shellAnimation = page.animate(
      [
        { clipPath: "inset(0 100% 0 0)", transform: `translateY(${direction * 14}px)` },
        { clipPath: "inset(0)", transform: "translateY(0)" },
      ],
      {
        duration: 430,
        easing: "cubic-bezier(.25,.46,.45,.94)",
        fill: "both",
      },
    );
    shellAnimationRef.current = shellAnimation;
    const entryElements = page.querySelectorAll<HTMLElement>("[data-dial-archive-entry]");
    entryAnimationsRef.current = Array.from(entryElements, (element, index) =>
      element.animate(
        [
          {
            clipPath: "inset(0 100% 0 0)",
            transform: `translateY(${direction * (index ? 16 : 22)}px)`,
          },
          { clipPath: "inset(0)", transform: "translateY(0)" },
        ],
        {
          duration: index ? 390 : 500,
          delay: index ? 105 : 42,
          easing: "cubic-bezier(.25,.46,.45,.94)",
          fill: "both",
        },
      ),
    );
  }, [
    clearAnimations,
    currentSpaceId,
    pageRef,
    reducedMotion,
    route.active,
    route.direction,
    scrollRef,
  ]);

  const requestSpace = useCallback(
    (nextSpaceId: HomeSpaceId) => {
      if (nextSpaceId === currentSpaceId && !route.active) return;
      clearTimers();
      clearAnimations();

      const version = ++routeVersionRef.current;
      const direction = spaceIndex(nextSpaceId) >= spaceIndex(currentSpaceId) ? 1 : -1;
      targetSpaceRef.current = nextSpaceId;
      setRoute({ active: !reducedMotion, direction, intentSpaceId: nextSpaceId, version });

      if (reducedMotion) {
        navigateRef.current(nextSpaceId);
        targetSpaceRef.current = null;
        return;
      }

      const page = pageRef.current;
      if (page && typeof page.animate === "function") {
        const computed = getComputedStyle(page);
        shellAnimationRef.current = page.animate(
          [
            {
              clipPath: computed.clipPath === "none" ? "inset(0)" : computed.clipPath,
              transform: computed.transform === "none" ? "translateY(0)" : computed.transform,
            },
            {
              clipPath: "inset(0 0 0 100%)",
              transform: `translateY(${direction * -10}px)`,
            },
          ],
          {
            duration: ROUTE_COMMIT_MS,
            easing: "cubic-bezier(.55,.055,.675,.19)",
            fill: "both",
          },
        );
      }

      timersRef.current = [
        window.setTimeout(() => {
          if (version === routeVersionRef.current) navigateRef.current(nextSpaceId);
        }, ROUTE_COMMIT_MS),
        window.setTimeout(() => {
          if (version !== routeVersionRef.current) return;
          clearAnimations();
          targetSpaceRef.current = null;
          setRoute((current) => ({ ...current, active: false }));
        }, ROUTE_FINISH_MS),
      ];
    },
    [clearAnimations, clearTimers, currentSpaceId, pageRef, reducedMotion, route.active],
  );

  return { ...route, requestSpace };
}
