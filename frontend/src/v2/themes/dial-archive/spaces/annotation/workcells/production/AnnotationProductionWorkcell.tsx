import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";

import type {
  AnnotationLaneId,
  AnnotationProjectContextContent,
  AnnotationProductionContent,
  AnnotationRequestPreviewContent,
  AnnotationStageAsset,
} from "../../../../../../pages/spaces/spacePageModel";
import { usePrefersReducedMotion } from "../../../../hooks/usePrefersReducedMotion";
import { useSpatialCanvasMotion } from "../../../hooks/useSpatialCanvasMotion";
import { AnnotationProductionCommit } from "./AnnotationProductionCommit";
import { AnnotationProductionConfiguration } from "./AnnotationProductionConfiguration";
import { AnnotationProductionOperation } from "./AnnotationProductionOperation";
import { AnnotationProductionRouteMap } from "./AnnotationProductionRouteMap";
import { AnnotationProjectContextSurface } from "../edit/AnnotationProjectContextSurface";
import { AnnotationRequestPreviewSurface } from "../edit/AnnotationRequestPreviewSurface";
import {
  ANNOTATION_PRODUCTION_ROUTE_LAYOUT,
  getProductionNodeCenter,
  projectProductionCanvasPointToMinimap,
  projectProductionCanvasRectToMinimap,
  resolveProductionFocus,
  type ProductionNodeId,
} from "./model/annotationProductionLayout";
import { ANNOTATION_PRODUCTION_LANE_PRESENTATION } from "./model/annotationProductionPresentation";

interface AnnotationProductionWorkcellProps {
  asset: AnnotationStageAsset | null;
  production: AnnotationProductionContent | null;
  projectContext: AnnotationProjectContextContent | null;
  requestPreview: AnnotationRequestPreviewContent | null;
}

type ProductionInspectorView = "configuration" | "context" | "request";
type ProductionInspectableNodeId = AnnotationLaneId | "terminal";

interface ProductionFocusRequest {
  node: ProductionNodeId;
  scale?: number;
}

interface ProductionMinimapStyle extends CSSProperties {
  "--dial-archive-production-minimap-padding": string;
}

interface ProductionCanvasSize {
  readonly width: number;
  readonly height: number;
  readonly inspectorWidth: number;
}

const PRODUCTION_CANVAS_GEOMETRY = {
  taskBounds: ANNOTATION_PRODUCTION_ROUTE_LAYOUT.taskBounds,
  overviewBounds: ANNOTATION_PRODUCTION_ROUTE_LAYOUT.overviewBounds,
  camera: ANNOTATION_PRODUCTION_ROUTE_LAYOUT.camera,
  projectRectToMinimap: projectProductionCanvasRectToMinimap,
} as const;

const PRODUCTION_NODE_IDS: readonly ProductionNodeId[] = [
  "source",
  "tags",
  "description",
  "translation",
  "terminal",
];

export function AnnotationProductionWorkcell({
  asset,
  production,
  projectContext,
  requestPreview,
}: AnnotationProductionWorkcellProps) {
  const reducedMotion = usePrefersReducedMotion();
  const [inspectorOpen, setInspectorOpen] = useState(() =>
    Boolean(
      production && production.status !== "inactive" && production.entryIntent !== "overview",
    ),
  );
  const [inspectorView, setInspectorView] = useState<ProductionInspectorView>("configuration");
  const [selectedNode, setSelectedNode] = useState<ProductionInspectableNodeId>(() =>
    production?.operation ? "terminal" : (production?.lane ?? "description"),
  );
  const [focusRequest, setFocusRequest] = useState<ProductionFocusRequest | null>(null);
  const [canvasSize, setCanvasSize] = useState<ProductionCanvasSize>({
    width: 0,
    height: 0,
    inspectorWidth: 0,
  });
  const inspectorRef = useRef<HTMLElement>(null);
  const appliedEntryRef = useRef<string | null>(null);
  const motion = useSpatialCanvasMotion({
    geometry: PRODUCTION_CANVAS_GEOMETRY,
    reducedMotion,
    occlusionRef: inspectorRef,
    occlusionActive: inspectorOpen,
  });
  const productionStatus = production?.status;
  const entryIntent = production?.entryIntent;
  const operationId = production?.operation?.id;
  const selectedLane = production?.lane;
  const focusAt = motion.focusAt;

  useEffect(() => {
    if (!productionStatus || productionStatus === "inactive") return;
    const requestKey = `${productionStatus}:${entryIntent}:${operationId ?? selectedLane}`;
    if (appliedEntryRef.current === requestKey) return;
    appliedEntryRef.current = requestKey;
    setInspectorView("configuration");
    if (entryIntent === "overview") {
      setSelectedNode(selectedLane ?? "description");
      setInspectorOpen(false);
      setFocusRequest({ node: "description", scale: 0.5 });
      return;
    }
    if (!selectedLane) return;
    setSelectedNode(operationId ? "terminal" : selectedLane);
    setInspectorOpen(true);
    setFocusRequest({ node: operationId ? "terminal" : selectedLane });
  }, [entryIntent, operationId, productionStatus, selectedLane]);

  useLayoutEffect(() => {
    const viewport = motion.viewportRef.current;
    if (!viewport) return;

    const updateSize = () => {
      const next = {
        width: viewport.clientWidth,
        height: viewport.clientHeight,
        inspectorWidth: inspectorOpen ? (inspectorRef.current?.offsetWidth ?? 0) : 0,
      };
      setCanvasSize((current) =>
        current.width === next.width &&
        current.height === next.height &&
        current.inspectorWidth === next.inspectorWidth
          ? current
          : next,
      );
    };

    updateSize();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(updateSize);
    observer.observe(viewport);
    if (inspectorRef.current) observer.observe(inspectorRef.current);
    return () => observer.disconnect();
  }, [inspectorOpen, motion.viewportRef]);

  useLayoutEffect(() => {
    if (!focusRequest) return;
    if (focusRequest.scale !== undefined) {
      const center = getProductionNodeCenter(focusRequest.node);
      focusAt(center.x, center.y, focusRequest.scale, true);
      return;
    }
    const target = resolveProductionFocus(focusRequest.node, canvasSize);
    focusAt(target.center.x, target.center.y, target.scale, true);
  }, [canvasSize, focusAt, focusRequest, inspectorOpen]);

  if (!production) {
    return (
      <div className="dial-archive-production-workcell is-empty" role="status">
        <span>PRODUCTION CONTEXT UNAVAILABLE</span>
        <b>生产路由场尚未建立</b>
      </div>
    );
  }

  const selectLane = (lane: AnnotationLaneId) => {
    setSelectedNode(lane);
    setInspectorOpen(true);
    setInspectorView("configuration");
    production.selectLane(lane);
    setFocusRequest({ node: lane });
  };

  const selectTerminal = () => {
    setSelectedNode("terminal");
    setInspectorOpen(true);
    setInspectorView("configuration");
    setFocusRequest({ node: "terminal" });
  };

  const reopenInspector = () => {
    setInspectorOpen(true);
    setFocusRequest({ node: selectedNode });
  };

  const closeInspector = () => {
    setInspectorOpen(false);
    setFocusRequest({ node: selectedNode });
  };

  const { surface, minimap } = ANNOTATION_PRODUCTION_ROUTE_LAYOUT;
  const inspectorLane = selectedNode === "terminal" ? production.lane : selectedNode;
  const identity = ANNOTATION_PRODUCTION_LANE_PRESENTATION[inspectorLane];
  const inspectorRegister = production.operation
    ? "OPERATION INSPECTOR"
    : selectedNode === "terminal"
      ? "COMMIT INSPECTOR"
      : "NODE INSPECTOR";
  const inspectorCode = selectedNode === "terminal" ? "CMT.04" : identity.code;
  const inspectorTitle = production.operation
    ? production.operation.statusLabel
    : selectedNode === "terminal"
      ? "合流写入"
      : identity.title;
  const surfaceStyle = { width: surface.width, height: surface.height };
  const minimapStyle = {
    width: minimap.width,
    height: minimap.height,
    "--dial-archive-production-minimap-padding": `${minimap.padding}px`,
  } as ProductionMinimapStyle;

  return (
    <div
      className={`dial-archive-production-workcell is-${production.lane}${
        inspectorOpen ? " has-inspector" : ""
      }`}
    >
      <div
        className="dial-archive-production-workcell__route-field dial-archive-preparation-canvas"
        ref={motion.viewportRef}
        role="region"
        aria-label="可拖动的生产路由画布"
        tabIndex={0}
        onPointerDown={motion.onPointerDown}
        onPointerMove={motion.onPointerMove}
        onPointerUp={motion.onPointerUp}
        onPointerCancel={motion.onPointerCancel}
        onWheel={motion.onWheel}
        onKeyDown={motion.onKeyDown}
      >
        {asset ? (
          <figure
            className="dial-archive-production-routes__evidence dial-archive-preparation-canvas__frame"
            aria-hidden="true"
          >
            <img src={asset.thumbnailUrl} alt="" draggable={false} />
            <figcaption>
              <span>SOURCE / {asset.suffix.replace(/^\./u, "").toUpperCase()}</span>
              <b>
                {asset.width} × {asset.height}
              </b>
              <small>{asset.filename}</small>
            </figcaption>
          </figure>
        ) : null}
        <div
          className="dial-archive-production-workcell__surface dial-archive-preparation-canvas__surface"
          ref={motion.surfaceRef}
          style={surfaceStyle}
        >
          <div
            className="dial-archive-production-workcell__scene dial-archive-preparation-canvas__scene"
            ref={motion.sceneRef}
            style={surfaceStyle}
          >
            <AnnotationProductionRouteMap
              production={production}
              selectedNode={selectedNode}
              onSelectLane={selectLane}
              onSelectTerminal={selectTerminal}
            />
          </div>
        </div>

        <div
          className="dial-archive-production-workcell__help dial-archive-preparation-canvas__help"
          aria-hidden="true"
        >
          <span>DRAG BLANK FIELD TO PAN</span>
          <span>WHEEL TO SCALE</span>
          <span>SHIFT + WHEEL TO TRACK</span>
          <span>0 // FIT TO TASK</span>
        </div>

        <div
          className="dial-archive-production-workcell__controls dial-archive-preparation-canvas__controls"
          aria-label="生产画布视图控制"
        >
          <button type="button" aria-label="缩小生产画布" onClick={motion.zoomOut}>
            −
          </button>
          <output ref={motion.scaleReadoutRef}>100%</output>
          <button type="button" aria-label="放大生产画布" onClick={motion.zoomIn}>
            ＋
          </button>
          <button type="button" onClick={() => motion.fit()}>
            FIT TO TASK
          </button>
        </div>

        <div
          className="dial-archive-production-workcell__minimap dial-archive-preparation-minimap"
          style={minimapStyle}
          aria-hidden="true"
        >
          {PRODUCTION_NODE_IDS.map((node) => {
            const point = projectProductionCanvasPointToMinimap(getProductionNodeCenter(node));
            return (
              <span
                className={node === selectedNode ? "is-selected" : undefined}
                style={{
                  top: point.y - minimap.markerHeight / 2,
                  left: point.x - minimap.markerWidth / 2,
                  width: minimap.markerWidth,
                  height: minimap.markerHeight,
                }}
                key={node}
              />
            );
          })}
          <i ref={motion.minimapViewportRef} />
        </div>
      </div>

      {inspectorOpen ? (
        <aside
          className="dial-archive-production-workcell__console-field dial-archive-preparation-inspector"
          id="annotation-production-inspector"
          ref={inspectorRef}
          aria-label="生产执行检查器"
        >
          <header className="dial-archive-production-workcell__console-head">
            <div>
              <span>{inspectorRegister} //</span>
              <b>{inspectorCode}</b>
              <h2>{inspectorTitle}</h2>
            </div>
            <button
              className="dial-archive-production-workcell__console-close"
              type="button"
              aria-label="关闭生产执行检查器"
              onClick={closeInspector}
            >
              ×
            </button>
          </header>
          <div className="dial-archive-production-workcell__console-body dial-archive-preparation-inspector__body">
            {!production.operation && selectedNode !== "terminal" ? (
              <nav
                className="dial-archive-production-input-nav"
                data-active-view={inspectorView}
                aria-label="生产输入阶段"
              >
                {(
                  [
                    ["configuration", "CONFIG", "任务参数"],
                    ["context", "CONTEXT", "项目上下文"],
                    ["request", "REQUEST", "请求预览"],
                  ] as const
                ).map(([id, code, label]) => (
                  <button
                    className={inspectorView === id ? "is-active" : undefined}
                    type="button"
                    aria-pressed={inspectorView === id}
                    onClick={() => setInspectorView(id)}
                    key={id}
                  >
                    <span>{code}</span>
                    <b>{label}</b>
                  </button>
                ))}
              </nav>
            ) : null}
            <div
              className={`dial-archive-production-inspector-view is-${inspectorView}`}
              key={production.operation?.id ?? `${selectedNode}:${inspectorView}`}
            >
              {production.status === "loading" ? (
                <section className="dial-archive-production-loading" role="status">
                  <span>LOADING EXECUTION REGISTER</span>
                  <b>正在校准生产线路</b>
                  <i aria-hidden="true" />
                </section>
              ) : production.status === "error" ? (
                <section className="dial-archive-production-loading is-error" role="alert">
                  <span>ROUTE REGISTER FAILURE</span>
                  <b>生产任务无法读取</b>
                  <p>{production.message ?? "指定任务记录不可用。"}</p>
                  <button type="button" onClick={production.createNew}>
                    返回新任务配置
                  </button>
                </section>
              ) : production.operation ? (
                <AnnotationProductionOperation
                  operation={production.operation}
                  message={production.message}
                  onCreateNew={production.createNew}
                />
              ) : selectedNode === "terminal" ? (
                <AnnotationProductionCommit
                  lane={production.lane}
                  configuration={production.configuration}
                  message={production.message}
                />
              ) : inspectorView === "context" && projectContext ? (
                <div className="dial-archive-production-input-surface is-context">
                  <AnnotationProjectContextSurface context={projectContext} compact />
                </div>
              ) : inspectorView === "request" && requestPreview ? (
                <div className="dial-archive-production-input-surface is-request">
                  <AnnotationRequestPreviewSurface preview={requestPreview} asset={asset} compact />
                </div>
              ) : (
                <AnnotationProductionConfiguration
                  lane={inspectorLane}
                  configuration={production.configuration}
                />
              )}
            </div>
          </div>
          <footer className="dial-archive-production-workcell__console-foot">
            <span>NODE // {inspectorCode}</span>
            <b>
              {production.operation
                ? `${production.operation.statusLabel} ${production.operation.progressPercent}%`
                : production.configuration.ready
                  ? "PARAMETERS READY"
                  : `${production.configuration.blockers.length} INTERLOCK`}
            </b>
          </footer>
        </aside>
      ) : (
        <button
          className="dial-archive-production-workcell__console-reopen dial-archive-preparation-inspector-reopen"
          type="button"
          aria-label={`打开生产执行检查器：${selectedNode.toUpperCase()}`}
          onClick={reopenInspector}
        >
          <span>EXECUTION REGISTER</span>
          <b>INSPECT {selectedNode.toUpperCase()} →</b>
        </button>
      )}

      <div className="dial-archive-production-workcell__film-dock" aria-hidden="true">
        <span>RANGE EVIDENCE</span>
        <i />
        <b>{production.configuration.scopeCount.toString().padStart(4, "0")}</b>
        <small>MATERIAL IN SCOPE / FILM DOCK BELOW</small>
      </div>
    </div>
  );
}
