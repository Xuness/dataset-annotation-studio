import { useRef, useState, type CSSProperties } from "react";

import type {
  AnnotationLaneId,
  AnnotationProductionContent,
} from "../../../../../../pages/spaces/spacePageModel";
import { usePrefersReducedMotion } from "../../../../hooks/usePrefersReducedMotion";
import { useSpatialCanvasMotion } from "../../../hooks/useSpatialCanvasMotion";
import { AnnotationProductionConfiguration } from "./AnnotationProductionConfiguration";
import { AnnotationProductionOperation } from "./AnnotationProductionOperation";
import { AnnotationProductionRouteMap } from "./AnnotationProductionRouteMap";
import {
  ANNOTATION_PRODUCTION_ROUTE_LAYOUT,
  getProductionNodeCenter,
  projectProductionCanvasPointToMinimap,
  projectProductionCanvasRectToMinimap,
  type ProductionNodeId,
} from "./model/annotationProductionLayout";

interface AnnotationProductionWorkcellProps {
  production: AnnotationProductionContent | null;
}

interface ProductionMinimapStyle extends CSSProperties {
  "--dial-archive-production-minimap-padding": string;
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

export function AnnotationProductionWorkcell({ production }: AnnotationProductionWorkcellProps) {
  const reducedMotion = usePrefersReducedMotion();
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const inspectorRef = useRef<HTMLElement>(null);
  const motion = useSpatialCanvasMotion({
    geometry: PRODUCTION_CANVAS_GEOMETRY,
    reducedMotion,
    occlusionRef: inspectorRef,
    occlusionActive: inspectorOpen,
  });

  if (!production) {
    return (
      <div className="dial-archive-production-workcell is-empty" role="status">
        <span>PRODUCTION CONTEXT UNAVAILABLE</span>
        <b>生产路由场尚未建立</b>
      </div>
    );
  }

  const selectLane = (lane: AnnotationLaneId) => {
    setInspectorOpen(true);
    production.selectLane(lane);
    const center = getProductionNodeCenter(lane);
    motion.focusAt(center.x, center.y, undefined, true);
  };

  const openInspector = () => {
    setInspectorOpen(true);
    const center = getProductionNodeCenter(production.operation ? "terminal" : production.lane);
    motion.focusAt(center.x, center.y, undefined, true);
  };

  const { surface, minimap } = ANNOTATION_PRODUCTION_ROUTE_LAYOUT;
  const surfaceStyle = { width: surface.width, height: surface.height };
  const minimapStyle = {
    width: minimap.width,
    height: minimap.height,
    "--dial-archive-production-minimap-padding": `${minimap.padding}px`,
  } as ProductionMinimapStyle;

  return (
    <div className={`dial-archive-production-workcell is-${production.lane}`}>
      <div
        className="dial-archive-production-workcell__route-field"
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
          className="dial-archive-production-workcell__surface"
          ref={motion.surfaceRef}
          style={surfaceStyle}
        >
          <div
            className="dial-archive-production-workcell__scene"
            ref={motion.sceneRef}
            style={surfaceStyle}
          >
            <AnnotationProductionRouteMap
              production={production}
              onSelectLane={selectLane}
              onOpenInspector={openInspector}
            />
          </div>
        </div>

        <div className="dial-archive-production-workcell__help" aria-hidden="true">
          <span>DRAG BLANK FIELD TO PAN</span>
          <span>WHEEL TO SCALE</span>
          <span>0 // FIT TO ROUTE</span>
        </div>

        <div className="dial-archive-production-workcell__controls" aria-label="生产画布视图控制">
          <button type="button" aria-label="缩小生产画布" onClick={motion.zoomOut}>
            −
          </button>
          <output ref={motion.scaleReadoutRef}>100%</output>
          <button type="button" aria-label="放大生产画布" onClick={motion.zoomIn}>
            ＋
          </button>
          <button type="button" onClick={() => motion.fit()}>
            FIT TO ROUTE
          </button>
        </div>

        <div
          className="dial-archive-production-workcell__minimap"
          style={minimapStyle}
          aria-hidden="true"
        >
          {PRODUCTION_NODE_IDS.map((node) => {
            const point = projectProductionCanvasPointToMinimap(getProductionNodeCenter(node));
            return (
              <span
                className={
                  node === production.lane || (node === "terminal" && production.operation)
                    ? "is-selected"
                    : undefined
                }
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
          className="dial-archive-production-workcell__console-field"
          id="annotation-production-inspector"
          ref={inspectorRef}
          aria-label="生产执行检查器"
        >
          <button
            className="dial-archive-production-workcell__console-close"
            type="button"
            aria-label="关闭生产执行检查器"
            onClick={() => setInspectorOpen(false)}
          >
            ×
          </button>
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
          ) : (
            <AnnotationProductionConfiguration
              lane={production.lane}
              configuration={production.configuration}
              message={production.message}
            />
          )}
        </aside>
      ) : (
        <button
          className="dial-archive-production-workcell__console-reopen"
          type="button"
          onClick={openInspector}
        >
          <span>EXECUTION REGISTER</span>
          <b>INSPECT {production.lane.toUpperCase()} →</b>
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
