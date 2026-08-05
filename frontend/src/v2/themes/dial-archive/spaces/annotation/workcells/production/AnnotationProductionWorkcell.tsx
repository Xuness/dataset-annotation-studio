import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";

import type {
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
import { AnnotationProductionScope } from "./AnnotationProductionScope";
import { AnnotationProjectContextSurface } from "../edit/AnnotationProjectContextSurface";
import { AnnotationRequestPreviewSurface } from "../edit/AnnotationRequestPreviewSurface";
import {
  ANNOTATION_PRODUCTION_ROUTE_LAYOUT,
  PRODUCTION_CANVAS_NODE_IDS,
  getProductionNodeCenter,
  isProductionLaneNode,
  projectProductionCanvasPointToMinimap,
  projectProductionCanvasRectToMinimap,
  type ProductionCanvasNodeId,
} from "./model/annotationProductionLayout";
import { ANNOTATION_PRODUCTION_LANE_PRESENTATION } from "./model/annotationProductionPresentation";

interface AnnotationProductionWorkcellProps {
  asset: AnnotationStageAsset | null;
  assets: readonly AnnotationStageAsset[];
  production: AnnotationProductionContent | null;
  projectContext: AnnotationProjectContextContent | null;
  requestPreview: AnnotationRequestPreviewContent | null;
}

type ProductionInspectorView = "configuration" | "context" | "request";

interface ProductionMinimapStyle extends CSSProperties {
  "--dial-archive-production-minimap-padding": string;
  "--dial-archive-minimap-padding": string;
}

interface ProductionSurfaceStyle extends CSSProperties {
  "--dial-archive-grid-minor": string;
  "--dial-archive-grid-major": string;
}

const PRODUCTION_CANVAS_GEOMETRY = {
  taskBounds: ANNOTATION_PRODUCTION_ROUTE_LAYOUT.taskBounds,
  overviewBounds: ANNOTATION_PRODUCTION_ROUTE_LAYOUT.overviewBounds,
  camera: ANNOTATION_PRODUCTION_ROUTE_LAYOUT.camera,
  projectRectToMinimap: projectProductionCanvasRectToMinimap,
} as const;

export function AnnotationProductionWorkcell({
  asset,
  assets,
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
  const [selectedNode, setSelectedNode] = useState<ProductionCanvasNodeId>(() =>
    production?.operation ? "result" : (production?.lane ?? "description"),
  );
  const inspectorRef = useRef<HTMLElement>(null);
  const appliedEntryRef = useRef<string | null>(null);
  const pendingFocusRef = useRef<ProductionCanvasNodeId | null>(null);
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
  const fitCanvas = motion.fit;

  useLayoutEffect(() => {
    const node = pendingFocusRef.current;
    if (!inspectorOpen || !node) return;
    pendingFocusRef.current = null;
    const center = getProductionNodeCenter(node);
    focusAt(center.x, center.y);
  }, [focusAt, inspectorOpen]);

  useEffect(() => {
    if (!productionStatus || productionStatus === "inactive") return;
    const requestKey = `${productionStatus}:${entryIntent}:${operationId ?? selectedLane}`;
    if (appliedEntryRef.current === requestKey) return;
    appliedEntryRef.current = requestKey;
    setInspectorView("configuration");
    if (entryIntent === "overview") {
      pendingFocusRef.current = null;
      setSelectedNode(selectedLane ?? "description");
      setInspectorOpen(false);
      fitCanvas(true);
      return;
    }
    if (!selectedLane) return;
    const node = operationId ? "result" : selectedLane;
    setSelectedNode(node);
    if (!inspectorOpen) {
      pendingFocusRef.current = node;
      setInspectorOpen(true);
      return;
    }
    const center = getProductionNodeCenter(node);
    focusAt(center.x, center.y);
  }, [entryIntent, fitCanvas, focusAt, inspectorOpen, operationId, productionStatus, selectedLane]);

  if (!production) {
    return (
      <div className="dial-archive-production-workcell is-empty" role="status">
        <span>PRODUCTION CONTEXT UNAVAILABLE</span>
        <b>生产路由场尚未建立</b>
      </div>
    );
  }

  const selectNode = (node: ProductionCanvasNodeId) => {
    setSelectedNode(node);
    if (!inspectorOpen) {
      pendingFocusRef.current = node;
      setInspectorOpen(true);
    }
    if (isProductionLaneNode(node)) {
      appliedEntryRef.current = `${production.status}:lane:${node}`;
      production.selectLane(node);
    }
    setInspectorView(
      node === "source" ? "context" : node === "validation" ? "request" : "configuration",
    );
    if (inspectorOpen) {
      const center = getProductionNodeCenter(node);
      focusAt(center.x, center.y);
    }
  };

  const reopenInspector = () => {
    pendingFocusRef.current = selectedNode;
    setInspectorOpen(true);
  };

  const closeInspector = () => {
    pendingFocusRef.current = null;
    setInspectorOpen(false);
  };

  const { surface, minimap } = ANNOTATION_PRODUCTION_ROUTE_LAYOUT;
  const inspectorLane = isProductionLaneNode(selectedNode) ? selectedNode : production.lane;
  const identity = ANNOTATION_PRODUCTION_LANE_PRESENTATION[inspectorLane];
  const inspectorRegister = production.operation
    ? "OPERATION INSPECTOR"
    : selectedNode === "source"
      ? "SOURCE INSPECTOR"
      : selectedNode === "scope"
        ? "SCOPE INSPECTOR"
        : selectedNode === "validation"
          ? "PREVIEW INSPECTOR"
          : selectedNode === "terminal" || selectedNode === "result"
            ? "COMMIT INSPECTOR"
            : "NODE INSPECTOR";
  const inspectorCode =
    selectedNode === "source"
      ? "SRC.00"
      : selectedNode === "scope"
        ? "SCP.01"
        : selectedNode === "validation"
          ? "PRV.04"
          : selectedNode === "terminal"
            ? "CMT.05"
            : selectedNode === "result"
              ? "RES.06"
              : identity.code;
  const inspectorTitle = production.operation
    ? production.operation.statusLabel
    : selectedNode === "source"
      ? "当前素材"
      : selectedNode === "scope"
        ? "处理范围"
        : selectedNode === "validation"
          ? "路线校验"
          : selectedNode === "terminal" || selectedNode === "result"
            ? "合流写入"
            : identity.title;
  const inspectorTabs =
    selectedNode === "validation"
      ? ([["request", "REQUEST", "请求预览"]] as const)
      : selectedNode === "source"
        ? ([["context", "CONTEXT", "项目上下文"]] as const)
        : selectedNode === "scope"
          ? ([["configuration", "CONFIG", "任务参数"]] as const)
          : isProductionLaneNode(selectedNode)
            ? ([
                ["configuration", "CONFIG", "任务参数"],
                ["context", "CONTEXT", "项目上下文"],
              ] as const)
            : [];
  const surfaceStyle = {
    width: surface.width,
    height: surface.height,
    "--dial-archive-grid-minor": `${ANNOTATION_PRODUCTION_ROUTE_LAYOUT.grid.minor}px`,
    "--dial-archive-grid-major": `${ANNOTATION_PRODUCTION_ROUTE_LAYOUT.grid.major}px`,
  } as ProductionSurfaceStyle;
  const minimapStyle = {
    width: minimap.width,
    height: minimap.height,
    "--dial-archive-production-minimap-padding": `${minimap.padding}px`,
    "--dial-archive-minimap-padding": `${minimap.padding}px`,
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
              asset={asset}
              assets={assets}
              production={production}
              selectedNode={selectedNode}
              onSelectNode={selectNode}
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
          {PRODUCTION_CANVAS_NODE_IDS.map((node) => {
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
            {!production.operation && inspectorTabs.length > 0 ? (
              <nav
                className="dial-archive-production-input-nav"
                data-active-view={inspectorView}
                data-tab-count={inspectorTabs.length}
                aria-label="生产输入阶段"
              >
                {inspectorTabs.map(([id, code, label]) => (
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
              ) : selectedNode === "terminal" || selectedNode === "result" ? (
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
              ) : selectedNode === "scope" ? (
                <AnnotationProductionScope configuration={production.configuration} />
              ) : (
                <AnnotationProductionConfiguration
                  lane={inspectorLane}
                  configuration={production.configuration}
                />
              )}
            </div>
          </div>
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
    </div>
  );
}
