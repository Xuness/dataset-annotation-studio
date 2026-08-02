import { useRef } from "react";

import type { ThemeSpacePageProps } from "../../themeTypes";
import { usePrefersReducedMotion } from "../hooks/usePrefersReducedMotion";
import "../styles/tokens.css";
import { ArchiveSpaceContent } from "./components/ArchiveSpaceContent";
import { PendingSpaceContent } from "./components/PendingSpaceContent";
import { RouteHandoff } from "./components/RouteHandoff";
import { SpaceChrome } from "./components/SpaceChrome";
import { SpaceRail } from "./components/SpaceRail";
import { useSpaceRouteTransition } from "./hooks/useSpaceRouteTransition";
import "./styles/space.css";
import "./styles/archive.css";
import "./styles/motion.css";

export function DialArchiveSpacePage({
  space,
  content,
  onNavigateSpace,
  onReturnHome,
}: ThemeSpacePageProps) {
  const rootRef = useRef<HTMLElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const pageRef = useRef<HTMLDivElement>(null);
  const reducedMotion = usePrefersReducedMotion();
  const route = useSpaceRouteTransition({
    currentSpaceId: space.id,
    reducedMotion,
    pageRef,
    scrollRef,
    onNavigateSpace,
  });

  return (
    <main
      className="dial-archive-space"
      ref={rootRef}
      aria-label={`Dataset Annotation Studio ${space.label}`}
    >
      <SpaceChrome space={space} />
      <SpaceRail
        currentSpace={space}
        intentSpaceId={route.intentSpaceId}
        routing={route.active}
        onRequestSpace={route.requestSpace}
        onReturnHome={() => onReturnHome(space.id)}
      />
      <div className="dial-archive-space__scroll" ref={scrollRef}>
        <div
          className={`dial-archive-space__page${route.active ? " is-routing" : ""}`}
          ref={pageRef}
        >
          {space.id === "archive" && content.kind === "archive" ? (
            <ArchiveSpaceContent content={content} />
          ) : (
            <PendingSpaceContent space={space} />
          )}
        </div>
      </div>
      <RouteHandoff spaceId={route.intentSpaceId} running={route.active} version={route.version} />
    </main>
  );
}
