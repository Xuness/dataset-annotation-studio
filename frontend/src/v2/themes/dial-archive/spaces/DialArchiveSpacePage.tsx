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
import { PreparationSpaceContent } from "./preparation/PreparationSpaceContent";
import { PreparationWorkbench } from "./preparation/PreparationWorkbench";
import "./styles/space.css";
import "./styles/archive.css";
import "./styles/preparation.css";
import "./styles/workbench.css";
import "./styles/motion.css";

function DialArchiveSecondarySpacePage({
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
          ) : space.id === "preparation" && content.kind === "preparation" ? (
            <PreparationSpaceContent content={content} />
          ) : (
            <PendingSpaceContent space={space} />
          )}
        </div>
      </div>
      <RouteHandoff spaceId={route.intentSpaceId} running={route.active} version={route.version} />
    </main>
  );
}

export function DialArchiveSpacePage(props: ThemeSpacePageProps) {
  if (props.content.kind === "preparation-workbench") {
    return (
      <main
        className="dial-archive-space dial-archive-space--workbench"
        aria-label="Dataset Annotation Studio 数据整备任务画布"
      >
        <SpaceChrome space={props.space} />
        <PreparationWorkbench content={props.content} />
      </main>
    );
  }
  return <DialArchiveSecondarySpacePage {...props} />;
}
