import { useCallback, useMemo, useRef } from "react";

import type {
  AnnotationLaneId,
  AnnotationSpaceContent as AnnotationSpaceContentModel,
  CapabilitySpaceContent as CapabilitySpaceContentModel,
  DeliverySpaceContent as DeliverySpaceContentModel,
  PreparationCanvasNodeId,
  PreparationCapabilityId,
  PreparationSpaceContent as PreparationSpaceContentModel,
  QualitySpaceContent as QualitySpaceContentModel,
} from "../../../pages/spaces/spacePageModel";
import type { ThemeSpacePageProps } from "../../themeTypes";
import { RouteSweep } from "../components/RouteSweep";
import { usePrefersReducedMotion } from "../hooks/usePrefersReducedMotion";
import { useRouteSweepTransition } from "../hooks/useRouteSweepTransition";
import "../styles/tokens.css";
import { AnnotationSpaceContent } from "./annotation/AnnotationSpaceContent";
import { AnnotationStage } from "./annotation/stage/AnnotationStage";
import { ArchiveSpaceContent } from "./components/ArchiveSpaceContent";
import { CapabilitySpace } from "./capability/CapabilitySpace";
import { DeliverySpaceContent } from "./delivery/DeliverySpaceContent";
import { DeliveryWorkbench } from "./delivery/DeliveryWorkbench";
import { PendingSpaceContent } from "./components/PendingSpaceContent";
import { RouteHandoff } from "./components/RouteHandoff";
import { SpaceChrome } from "./components/SpaceChrome";
import { SpaceRail } from "./components/SpaceRail";
import { useSpaceRouteTransition } from "./hooks/useSpaceRouteTransition";
import { PreparationSpaceContent } from "./preparation/PreparationSpaceContent";
import { PreparationWorkbench } from "./preparation/PreparationWorkbench";
import { QualityReviewStage } from "./quality/QualityReviewStage";
import { QualitySpaceContent } from "./quality/QualitySpaceContent";
import "./styles/space.css";
import "./styles/archive.css";
import "./styles/annotation.css";
import "./annotation/styles/annotation-stage.css";
import "./styles/preparation.css";
import "./styles/workbench.css";
import "./annotation/styles/annotation-production-canvas-parity.css";
import "./quality/styles/quality.css";
import "./quality/styles/quality-reconstruction.css";
import "./delivery/styles/delivery.css";
import "./delivery/styles/delivery-workbench.css";
import "./capability/styles/capability.css";
import "./styles/motion.css";

interface DialArchiveCapabilitySpacePageProps extends Omit<ThemeSpacePageProps, "content"> {
  content: CapabilitySpaceContentModel;
}

function DialArchiveCapabilitySpacePage({
  space,
  content,
  onNavigateSpace,
  onReturnHome,
}: DialArchiveCapabilitySpacePageProps) {
  const reducedMotion = usePrefersReducedMotion();
  const pageRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const route = useSpaceRouteTransition({
    currentSpaceId: space.id,
    reducedMotion,
    pageRef,
    scrollRef: viewportRef,
    onNavigateSpace,
  });

  return (
    <main
      className="dial-archive-space dial-archive-space--capability"
      aria-label="Dataset Annotation Studio 能力库"
    >
      <SpaceChrome space={space} />
      <SpaceRail
        currentSpace={space}
        intentSpaceId={route.intentSpaceId}
        routing={route.active}
        onRequestSpace={route.requestSpace}
        onReturnHome={() => onReturnHome(space.id)}
      />
      <div className="dial-archive-capability-viewport" ref={viewportRef}>
        <div
          className={`dial-archive-capability-page${route.active ? " is-routing" : ""}`}
          ref={pageRef}
        >
          <CapabilitySpace content={content} />
        </div>
      </div>
      <RouteHandoff spaceId={route.intentSpaceId} running={route.active} version={route.version} />
    </main>
  );
}

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
  const {
    label: routeSweepLabel,
    running: routeSweepRunning,
    start: startRouteSweep,
    version: routeSweepVersion,
  } = useRouteSweepTransition({ reducedMotion });
  const route = useSpaceRouteTransition({
    currentSpaceId: space.id,
    reducedMotion,
    pageRef,
    scrollRef,
    onNavigateSpace,
  });
  const enterPreparationWorkbench = useCallback(
    (onCommit: () => void) => {
      startRouteSweep({
        label: "ENTERING // PRP — WORKBENCH",
        onCommit,
      });
    },
    [startRouteSweep],
  );
  const preparationContent = useMemo<PreparationSpaceContentModel | null>(() => {
    if (content.kind !== "preparation") return null;
    return {
      ...content,
      openWorkbench: (focus?: PreparationCapabilityId) =>
        enterPreparationWorkbench(() =>
          focus ? content.openWorkbench(focus) : content.openWorkbench(),
        ),
      openOperation: (operationId: string, focus?: PreparationCanvasNodeId) =>
        enterPreparationWorkbench(() => content.openOperation(operationId, focus)),
    };
  }, [content, enterPreparationWorkbench]);
  const annotationContent = useMemo<AnnotationSpaceContentModel | null>(() => {
    if (content.kind !== "annotation") return null;
    return {
      ...content,
      openWorkbench: (assetId?: string, lane?: AnnotationLaneId) =>
        startRouteSweep({
          label: "ENTERING // ANN — MATERIAL DESK",
          onCommit: () => content.openWorkbench(assetId, lane),
        }),
      openProduction: (lane?: AnnotationLaneId, operationId?: string) =>
        startRouteSweep({
          label: "ENTERING // ANN — PRODUCTION ROUTE",
          onCommit: () => content.openProduction(lane, operationId),
        }),
    };
  }, [content, startRouteSweep]);
  const qualityContent = useMemo<QualitySpaceContentModel | null>(() => {
    if (content.kind !== "quality") return null;
    return {
      ...content,
      openReview: (assetId, channel) =>
        startRouteSweep({
          label: "ENTERING // QAC — REVIEW DESK",
          onCommit: () => content.openReview(assetId, channel),
        }),
      openAnnotation: (assetId, channel) =>
        startRouteSweep({
          label: "RETURNING // ANN — REPAIR ROUTE",
          onCommit: () => content.openAnnotation(assetId, channel),
        }),
    };
  }, [content, startRouteSweep]);
  const deliveryContent = useMemo<DeliverySpaceContentModel | null>(() => {
    if (content.kind !== "delivery") return null;
    return {
      ...content,
      openWorkbench: (operationId) =>
        startRouteSweep({
          label: operationId ? "OPENING // DLV — OPERATION" : "ENTERING // DLV — WORKBENCH",
          onCommit: () => content.openWorkbench(operationId),
        }),
      openQuality: (filter) =>
        startRouteSweep({
          label: "RETURNING // QAC — QUALITY STATUS",
          onCommit: () => content.openQuality(filter),
        }),
    };
  }, [content, startRouteSweep]);

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
          ) : space.id === "preparation" && preparationContent ? (
            <PreparationSpaceContent content={preparationContent} />
          ) : space.id === "annotation" && annotationContent ? (
            <AnnotationSpaceContent content={annotationContent} />
          ) : space.id === "quality" && qualityContent ? (
            <QualitySpaceContent content={qualityContent} />
          ) : space.id === "delivery" && deliveryContent ? (
            <DeliverySpaceContent content={deliveryContent} />
          ) : (
            <PendingSpaceContent space={space} />
          )}
        </div>
      </div>
      <RouteHandoff spaceId={route.intentSpaceId} running={route.active} version={route.version} />
      <RouteSweep label={routeSweepLabel} running={routeSweepRunning} version={routeSweepVersion} />
    </main>
  );
}

export function DialArchiveSpacePage(props: ThemeSpacePageProps) {
  if (props.content.kind === "capability") {
    return <DialArchiveCapabilitySpacePage {...props} content={props.content} />;
  }
  if (props.content.kind === "delivery-workbench") {
    return (
      <main
        className="dial-archive-space dial-archive-space--delivery-workbench"
        aria-label="Dataset Annotation Studio 交付台"
      >
        <SpaceChrome space={props.space} />
        <DeliveryWorkbench content={props.content} />
      </main>
    );
  }
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
  if (props.content.kind === "annotation-stage") {
    return (
      <main
        className="dial-archive-space dial-archive-space--stage"
        aria-label="Dataset Annotation Studio 素材施工场"
      >
        <SpaceChrome space={props.space} />
        <AnnotationStage content={props.content} />
      </main>
    );
  }
  if (props.content.kind === "quality-review") {
    return (
      <main
        className="dial-archive-space dial-archive-space--quality-review"
        aria-label="Dataset Annotation Studio 证据复核台"
      >
        <SpaceChrome space={props.space} tone="dark" />
        <QualityReviewStage content={props.content} />
      </main>
    );
  }
  return <DialArchiveSecondarySpacePage {...props} />;
}
