import type { CSSProperties } from "react";

import type {
  AnnotationLaneId,
  AnnotationProductionContent,
} from "../../../../../../pages/spaces/spacePageModel";
import {
  ANNOTATION_PRODUCTION_ROUTE_LAYOUT,
  productionDecorRoutePath,
  productionNodeStyle,
  productionRoutePath,
  type ProductionNodeId,
} from "./model/annotationProductionLayout";

interface AnnotationProductionRouteMapProps {
  production: AnnotationProductionContent;
  selectedNode: ProductionNodeId;
  onSelectLane(lane: AnnotationLaneId): void;
  onSelectTerminal(): void;
}

function laneStateLabel(state: AnnotationProductionContent["lanes"][number]["state"]): string {
  if (state === "running") return "LIVE";
  if (state === "complete") return "COMPLETE";
  if (state === "ready") return "READY";
  if (state === "attention") return "ATTENTION";
  return "STANDBY";
}

function polarPoint(cx: number, cy: number, radius: number, degrees: number) {
  const angle = ((degrees - 90) * Math.PI) / 180;
  return {
    x: cx + radius * Math.cos(angle),
    y: cy + radius * Math.sin(angle),
  };
}

function RouteGauge() {
  const gauge = ANNOTATION_PRODUCTION_ROUTE_LAYOUT.gauge;
  return (
    <g className="dial-archive-production-gauge dial-archive-preparation-gauge">
      <circle
        className="dial-archive-preparation-gauge__ring"
        cx={gauge.cx}
        cy={gauge.cy}
        r={gauge.radius}
      />
      <circle
        className="dial-archive-preparation-gauge__ring"
        cx={gauge.cx}
        cy={gauge.cy}
        r={gauge.radius - 46}
      />
      <g
        className="dial-archive-production-gauge__rotor dial-archive-preparation-gauge__rotor"
        style={{ transformOrigin: `${gauge.cx}px ${gauge.cy}px`, animationDuration: "80s" }}
      >
        {Array.from({ length: gauge.tickCount }, (_, index) => {
          const major = index % gauge.majorEvery === 0;
          const degrees = (index / gauge.tickCount) * 360;
          const from = polarPoint(gauge.cx, gauge.cy, gauge.radius - (major ? 22 : 11), degrees);
          const to = polarPoint(gauge.cx, gauge.cy, gauge.radius, degrees);
          return (
            <line
              className={major ? "is-major" : undefined}
              x1={from.x}
              y1={from.y}
              x2={to.x}
              y2={to.y}
              key={index}
            />
          );
        })}
        <g className="dial-archive-preparation-gauge__arc">
          <path
            d={`M ${gauge.cx - gauge.radius} ${gauge.cy} A ${gauge.radius} ${gauge.radius} 0 0 1 ${gauge.cx} ${gauge.cy - gauge.radius}`}
          />
        </g>
      </g>
      <path
        className="is-crosshair"
        d={`M ${gauge.cx - 370} ${gauge.cy} L ${gauge.cx + 370} ${gauge.cy} M ${gauge.cx} ${gauge.cy - 370} L ${gauge.cx} ${gauge.cy + 370}`}
      />
    </g>
  );
}

export function AnnotationProductionRouteMap({
  production,
  selectedNode,
  onSelectLane,
  onSelectTerminal,
}: AnnotationProductionRouteMapProps) {
  const { configuration, operation } = production;
  const routeCount = production.lanes.filter((lane) => lane.state !== "inactive").length;
  const fieldReadings: Readonly<Record<string, string>> = {
    source: `${configuration.scopeCount.toLocaleString()} MATERIAL`,
    synthesis: `${routeCount || 1} / 3 COVERED`,
    commit: operation
      ? `${operation.statusLabel.toUpperCase()} / ${operation.progressPercent}%`
      : configuration.ready
        ? "SNAPSHOT ARMED"
        : "INTERLOCK OPEN",
  };

  return (
    <section
      className={`dial-archive-production-routes is-${production.lane}`}
      style={{
        width: ANNOTATION_PRODUCTION_ROUTE_LAYOUT.surface.width,
        height: ANNOTATION_PRODUCTION_ROUTE_LAYOUT.surface.height,
      }}
      aria-label="生产线路"
    >
      <div className="dial-archive-production-routes__ghost" aria-hidden="true">
        OPERATION
      </div>
      <div className="dial-archive-production-routes__blade" aria-hidden="true">
        <span>03 / VECTOR 02</span>
        <b>ROUTE FIELD</b>
      </div>
      <div
        className="dial-archive-production-routes__fields dial-archive-preparation-canvas__fields"
        aria-hidden="true"
      >
        {ANNOTATION_PRODUCTION_ROUTE_LAYOUT.fields.map((field) => (
          <section
            className={`dial-archive-production-routes__field dial-archive-preparation-canvas__field is-${field.id} is-${
              field.id === "synthesis" ? "transform" : field.id === "commit" ? "verify" : "input"
            } is-${field.id === "synthesis" ? "vertical" : "horizontal"}`}
            style={{
              top: field.rect.y,
              left: field.rect.x,
              width: field.rect.width,
              height: field.rect.height,
            }}
            key={field.id}
          >
            <span>{field.index}</span>
            <div>
              <small>{field.kicker}</small>
              <b>{field.title}</b>
            </div>
            <output>{fieldReadings[field.id] ?? field.reading}</output>
          </section>
        ))}
      </div>
      <div
        className="dial-archive-production-routes__contours dial-archive-preparation-canvas__contours"
        aria-hidden="true"
      />

      <svg
        className="dial-archive-production-routes__wiring dial-archive-preparation-connectors"
        viewBox={`0 0 ${ANNOTATION_PRODUCTION_ROUTE_LAYOUT.viewBox.width} ${ANNOTATION_PRODUCTION_ROUTE_LAYOUT.viewBox.height}`}
        aria-hidden="true"
      >
        <g className="dial-archive-production-routes__decor dial-archive-preparation-connectors__decor">
          {ANNOTATION_PRODUCTION_ROUTE_LAYOUT.decorRoutes.map((_, index) => (
            <path d={productionDecorRoutePath(index)} key={index} />
          ))}
        </g>
        <g className="dial-archive-preparation-connectors__gauges">
          <RouteGauge />
        </g>
        <g className="dial-archive-production-routes__main dial-archive-preparation-connectors__main">
          {production.lanes.map((lane, index) => (
            <path
              className={`is-route-bed ${
                lane.id === production.lane ? "is-active" : "is-bypassed"
              }`}
              style={{ "--dial-archive-edge-order": index } as CSSProperties}
              d={productionRoutePath(lane.id)}
              data-lane-id={lane.id}
              key={lane.id}
            />
          ))}
        </g>
        <g className="dial-archive-production-routes__junctions dial-archive-preparation-connectors__junctions">
          {ANNOTATION_PRODUCTION_ROUTE_LAYOUT.junctions.map((junction, index) => (
            <g
              className="dial-archive-production-junction is-active"
              transform={`translate(${junction.x} ${junction.y})`}
              key={index}
            >
              <rect x="-8" y="-8" width="16" height="16" />
              <circle r="3" />
            </g>
          ))}
        </g>
        {production.lanes.some((lane) => lane.state === "running") ? (
          <g className="dial-archive-production-routes__signal dial-archive-preparation-connectors__signal">
            {production.lanes
              .filter((lane) => lane.state === "running")
              .map((lane) => (
                <path d={productionRoutePath(lane.id)} data-lane-id={lane.id} key={lane.id} />
              ))}
          </g>
        ) : null}
      </svg>

      <div
        className="dial-archive-production-source dial-archive-preparation-node is-active"
        style={productionNodeStyle(ANNOTATION_PRODUCTION_ROUTE_LAYOUT.source)}
      >
        <span className="dial-archive-preparation-node__visual">
          <span className="dial-archive-preparation-node__corners" aria-hidden="true" />
          <span className="dial-archive-preparation-node__head">
            <em>处理范围</em>
            <i className="dial-archive-preparation-node__lamp" aria-hidden="true" />
          </span>
          <b className="dial-archive-preparation-node__code">SCP / 01</b>
          <small>{configuration.scopeCount.toLocaleString()} MATERIAL IN SCOPE</small>
          <span
            className="dial-archive-preparation-node__status dial-archive-production-source__scope"
            aria-label="任务素材范围"
          >
            <button
              className={configuration.scope === "all" ? "is-active" : undefined}
              type="button"
              disabled={Boolean(operation)}
              onClick={() => configuration.setScope("all")}
            >
              ALL {configuration.totalCount.toLocaleString()}
            </button>
            <button
              className={configuration.scope === "selected" ? "is-active" : undefined}
              type="button"
              disabled={Boolean(operation)}
              onClick={() => configuration.setScope("selected")}
            >
              RANGE {configuration.selectedCount.toLocaleString()}
            </button>
          </span>
          <span className="dial-archive-preparation-node__meter" aria-hidden="true">
            <i style={{ width: "100%" }} />
          </span>
        </span>
      </div>

      <div className="dial-archive-production-lanes" role="tablist" aria-label="选择生产线路">
        {production.lanes.map((lane) => {
          const active = lane.id === production.lane;
          const selected = lane.id === selectedNode;
          return (
            <button
              className={`dial-archive-production-lane dial-archive-preparation-node is-${lane.id} is-${lane.state} is-${
                active ? "active" : "bypassed"
              }${selected ? " is-selected" : ""}${lane.state === "running" ? " is-signaling" : ""}`}
              style={productionNodeStyle(ANNOTATION_PRODUCTION_ROUTE_LAYOUT.lanes[lane.id])}
              type="button"
              role="tab"
              aria-selected={active}
              aria-controls="annotation-production-console"
              onClick={() => onSelectLane(lane.id)}
              key={lane.id}
            >
              <span className="dial-archive-production-lane__visual dial-archive-preparation-node__visual">
                <span className="dial-archive-preparation-node__corners" aria-hidden="true" />
                <span className="dial-archive-production-lane__head dial-archive-preparation-node__head">
                  <em>{lane.title}</em>
                  <i className="dial-archive-preparation-node__lamp" aria-hidden="true" />
                </span>
                <b className="dial-archive-preparation-node__code">{lane.code}</b>
                <small>{lane.summary}</small>
                <span className="dial-archive-production-lane__reading dial-archive-preparation-node__status">
                  {laneStateLabel(lane.state)}
                  <strong>{lane.coveragePercent}%</strong>
                </span>
                <span className="dial-archive-preparation-node__meter" aria-hidden="true">
                  <i style={{ width: `${lane.coveragePercent}%` }} />
                </span>
              </span>
            </button>
          );
        })}
      </div>

      <button
        className={`dial-archive-production-terminal dial-archive-preparation-node is-active${
          selectedNode === "terminal" ? " is-selected" : ""
        } is-${operation?.tone ?? "configure"}`}
        style={productionNodeStyle(ANNOTATION_PRODUCTION_ROUTE_LAYOUT.terminal)}
        type="button"
        aria-label="打开合流写入检查器"
        aria-controls="annotation-production-inspector"
        aria-pressed={selectedNode === "terminal"}
        onClick={onSelectTerminal}
      >
        <span className="dial-archive-preparation-node__visual">
          <span className="dial-archive-preparation-node__corners" aria-hidden="true" />
          <span className="dial-archive-preparation-node__head">
            <em>合流写入</em>
            <i className="dial-archive-preparation-node__lamp" aria-hidden="true" />
          </span>
          <b className="dial-archive-preparation-node__code">COMMIT</b>
          <small>{operation ? operation.id : "EXECUTION SNAPSHOT"}</small>
          <span className="dial-archive-preparation-node__status">
            {operation
              ? operation.statusLabel.toUpperCase()
              : configuration.ready
                ? "ARMED"
                : "LOCKED"}
            <strong>
              {operation ? `${operation.progressPercent}%` : configuration.scopeCount}
            </strong>
          </span>
          <span className="dial-archive-preparation-node__meter" aria-hidden="true">
            <i
              style={{
                width: operation
                  ? `${operation.progressPercent}%`
                  : configuration.ready
                    ? "32%"
                    : "0%",
              }}
            />
          </span>
        </span>
      </button>
    </section>
  );
}
