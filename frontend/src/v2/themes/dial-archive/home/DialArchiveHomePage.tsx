import { useCallback, useEffect, useRef, useState } from "react";

import { RouteSweep } from "../components/RouteSweep";
import { useRouteSweepTransition } from "../hooks/useRouteSweepTransition";
import { usePrefersReducedMotion } from "../hooks/usePrefersReducedMotion";
import { DIAL_ARCHIVE_SPACES } from "../model/spacePresentation";
import type { ThemeHomePageProps } from "../../themeTypes";
import { ArchiveDial } from "./components/ArchiveDial";
import { CoreReadout } from "./components/CoreReadout";
import { DialArchiveChrome } from "./components/DialArchiveChrome";
import { SpaceDetails } from "./components/SpaceDetails";
import { WorkspaceIndex } from "./components/WorkspaceIndex";
import { useCanvasScale } from "./hooks/useCanvasScale";
import { usePointerParallax } from "./hooks/usePointerParallax";
import { DIAL_PREVIEW_INTENT_MS } from "./model/dialGeometry";
import "../styles/tokens.css";
import "./styles/home.css";
import "./styles/index.css";
import "./styles/dial.css";
import "./styles/motion.css";

interface ContentState {
  index: number;
  motionVersion: number;
}

function editableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

export function DialArchiveHomePage({ initialSpaceId, onEnterSpace }: ThemeHomePageProps) {
  const requestedInitialIndex = initialSpaceId
    ? DIAL_ARCHIVE_SPACES.findIndex((space) => space.id === initialSpaceId)
    : -1;
  const initialIndex = requestedInitialIndex >= 0 ? requestedInitialIndex : 0;
  const rootRef = useRef<HTMLElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const rowRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const reducedMotion = usePrefersReducedMotion();
  const {
    label: routeSweepLabel,
    running: routeSweepRunning,
    start: startRouteSweep,
    version: routeSweepVersion,
  } = useRouteSweepTransition({ reducedMotion });
  const [selectedIndex, setSelectedIndex] = useState(initialIndex);
  const [pointerPreviewIndex, setPointerPreviewIndex] = useState<number | null>(null);
  const [focusPreviewIndex, setFocusPreviewIndex] = useState<number | null>(null);
  const [content, setContent] = useState<ContentState>({
    index: initialIndex,
    motionVersion: 0,
  });
  const [confirmationVersion, setConfirmationVersion] = useState(0);

  useCanvasScale(rootRef, canvasRef);
  usePointerParallax(rootRef, reducedMotion);

  const displayIndex = pointerPreviewIndex ?? focusPreviewIndex ?? selectedIndex;
  const previewIndex = pointerPreviewIndex ?? focusPreviewIndex;
  const dialInteractionActive = pointerPreviewIndex !== null || focusPreviewIndex !== null;
  const selectedSpace = DIAL_ARCHIVE_SPACES[selectedIndex];
  const contentSpace = DIAL_ARCHIVE_SPACES[content.index];

  const landContent = useCallback((index: number) => {
    setContent((current) =>
      current.index === index ? current : { index, motionVersion: current.motionVersion + 1 },
    );
  }, []);

  useEffect(() => {
    if (reducedMotion || pointerPreviewIndex === null) {
      landContent(displayIndex);
      return;
    }

    const timer = window.setTimeout(() => landContent(displayIndex), DIAL_PREVIEW_INTENT_MS);
    return () => window.clearTimeout(timer);
  }, [displayIndex, landContent, pointerPreviewIndex, reducedMotion]);

  const commitSpace = useCallback((index: number) => {
    setSelectedIndex(index);
    setContent((current) => ({ index, motionVersion: current.motionVersion + 1 }));
    setConfirmationVersion((version) => version + 1);
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.defaultPrevented || editableTarget(event.target)) return;
      let delta = 0;
      if (event.key === "ArrowDown" || event.key === "ArrowRight") delta = 1;
      if (event.key === "ArrowUp" || event.key === "ArrowLeft") delta = -1;
      if (!delta) return;

      event.preventDefault();
      const nextIndex =
        (selectedIndex + delta + DIAL_ARCHIVE_SPACES.length) % DIAL_ARCHIVE_SPACES.length;
      setPointerPreviewIndex(null);
      setFocusPreviewIndex(null);
      commitSpace(nextIndex);
      rowRefs.current[nextIndex]?.focus({ preventScroll: true });
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [commitSpace, selectedIndex]);

  const enterSpace = useCallback(() => {
    const space = DIAL_ARCHIVE_SPACES[content.index];
    startRouteSweep({
      label: `ENTERING // ${space.code} — ${space.englishLabel}`,
      onCommit: () => onEnterSpace(space.id),
    });
  }, [content.index, onEnterSpace, startRouteSweep]);

  return (
    <main className="dial-archive-home" ref={rootRef} aria-label="Dataset Annotation Studio 首页">
      <div className="dial-archive-home__canvas" ref={canvasRef}>
        <div className="dial-archive-home__ghost" aria-hidden="true">
          <span
            className={content.motionVersion > 0 && !reducedMotion ? "is-wiping" : undefined}
            key={`ghost-${content.motionVersion}`}
          >
            {contentSpace.ghostLabel}
          </span>
        </div>

        <WorkspaceIndex
          spaces={DIAL_ARCHIVE_SPACES}
          selectedIndex={selectedIndex}
          previewIndex={previewIndex}
          rowRefs={rowRefs}
          onPointerPreview={setPointerPreviewIndex}
          onFocusPreview={setFocusPreviewIndex}
          onCommit={commitSpace}
        />

        <ArchiveDial
          spaces={DIAL_ARCHIVE_SPACES}
          displayIndex={displayIndex}
          selectedIndex={selectedIndex}
          contentIndex={content.index}
          reducedMotion={reducedMotion}
          interactionActive={dialInteractionActive}
          onFocusPreview={setFocusPreviewIndex}
          onCommit={commitSpace}
        />

        <CoreReadout
          space={contentSpace}
          motionVersion={content.motionVersion}
          reducedMotion={reducedMotion}
        />
        <SpaceDetails
          space={contentSpace}
          confirmationVersion={confirmationVersion}
          reducedMotion={reducedMotion}
          onEnter={enterSpace}
        />
        <DialArchiveChrome selectedSpace={selectedSpace} />
      </div>

      <RouteSweep label={routeSweepLabel} running={routeSweepRunning} version={routeSweepVersion} />

      <div className="dial-archive-home__portrait-note">
        本构图为横屏桌面设计
        <br />
        请将窗口调整为横屏后查看
      </div>
    </main>
  );
}
