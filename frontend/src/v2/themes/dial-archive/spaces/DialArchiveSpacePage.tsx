import { useCallback, useMemo, useRef } from "react";

import type {
  AnnotationLaneId,
  AnnotationSpaceContent as AnnotationSpaceContentModel,
  CapabilityCategoryContent as CapabilityCategoryContentModel,
  CapabilityDownloadWorkbenchContent as CapabilityDownloadWorkbenchContentModel,
  CapabilityLibraryContent as CapabilityLibraryContentModel,
  CapabilitySpaceContent as CapabilitySpaceContentModel,
  CapabilitySystemWorkbenchContent as CapabilitySystemWorkbenchContentModel,
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
import { CapabilityCategoryPage } from "./capability-library/CapabilityCategoryPage";
import { CapabilityDownloadWorkbenchPage } from "./capability-library/CapabilityDownloadWorkbenchPage";
import { CapabilityLibraryContent } from "./capability-library/CapabilityLibraryContent";
import { CapabilitySystemWorkbenchPage } from "./capability-library/CapabilitySystemWorkbenchPage";
import { CapabilityWorkbenchPage } from "./capability-library/CapabilityWorkbenchPage";
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
import "./capability-library/capability-library.css";
import "./capability-library/capability-category.css";
import "./capability-library/capability-workbench.css";
import "./capability-library/capability-utility-workbench.css";
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
  const capabilityLibraryContent = useMemo<CapabilityLibraryContentModel | null>(() => {
    if (content.kind !== "capability-library") return null;
    return {
      ...content,
      openCategory: (categoryId) => {
        const category = content.categories.find((candidate) => candidate.id === categoryId);
        startRouteSweep({
          label: `ENTERING // ${category?.code ?? "CAP"} — RESOURCE REGISTER`,
          onCommit: () => content.openCategory(categoryId),
        });
      },
    };
  }, [content, startRouteSweep]);
  const capabilityCategoryContent = useMemo<CapabilityCategoryContentModel | null>(() => {
    if (content.kind !== "capability-category") return null;
    return {
      ...content,
      selectCategory: (categoryId) => {
        const category = content.categories.find((candidate) => candidate.id === categoryId);
        startRouteSweep({
          label: `ROUTING // ${category?.code ?? "CAP"} — RESOURCE REGISTER`,
          onCommit: () => content.selectCategory(categoryId),
        });
      },
      returnOverview: () =>
        startRouteSweep({
          label: "RETURNING // CAP — LIBRARY OVERVIEW",
          onCommit: content.returnOverview,
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
          ) : space.id === "capability" && capabilityLibraryContent ? (
            <CapabilityLibraryContent content={capabilityLibraryContent} />
          ) : space.id === "capability" && capabilityCategoryContent ? (
            <CapabilityCategoryPage content={capabilityCategoryContent} />
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
  if (props.content.kind === "capability-download-workbench") {
    return (
      <main
        className="dial-archive-space dial-archive-space--capability-workbench"
        aria-label="Dataset Annotation Studio 能力下载工作台"
      >
        <SpaceChrome space={props.space} />
        <CapabilityDownloadWorkbenchPage
          content={props.content as CapabilityDownloadWorkbenchContentModel}
        />
      </main>
    );
  }
  if (props.content.kind === "capability-system-workbench") {
    return (
      <main
        className="dial-archive-space dial-archive-space--capability-workbench"
        aria-label="Dataset Annotation Studio Studio 控制工作台"
      >
        <SpaceChrome space={props.space} />
        <CapabilitySystemWorkbenchPage
          content={props.content as CapabilitySystemWorkbenchContentModel}
        />
      </main>
    );
  }
  if (props.content.kind === "capability") {
    return (
      <main
        className="dial-archive-space dial-archive-space--capability-workbench"
        aria-label="Dataset Annotation Studio 能力对象工作台"
      >
        <SpaceChrome space={props.space} />
        <CapabilityWorkbenchPage content={props.content as CapabilitySpaceContentModel} />
      </main>
    );
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
