import type {
  AnnotationLaneId,
  AnnotationProductionContent,
} from "../../../../../../pages/spaces/spacePageModel";
import {
  ANNOTATION_PRODUCTION_ROUTE_LAYOUT,
  productionDecorRoutePath,
  productionNodeStyle,
  productionRoutePath,
} from "./model/annotationProductionLayout";

interface AnnotationProductionRouteMapProps {
  production: AnnotationProductionContent;
  onSelectLane(lane: AnnotationLaneId): void;
  onOpenInspector(): void;
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
    <g className="dial-archive-production-gauge">
      <circle cx={gauge.cx} cy={gauge.cy} r={gauge.radius} />
      <circle cx={gauge.cx} cy={gauge.cy} r={gauge.radius - 46} />
      <g className="dial-archive-production-gauge__rotor">
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
        <path
          d={`M ${gauge.cx - gauge.radius} ${gauge.cy} A ${gauge.radius} ${gauge.radius} 0 0 1 ${gauge.cx} ${gauge.cy - gauge.radius}`}
        />
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
  onSelectLane,
  onOpenInspector,
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
      className="dial-archive-production-routes"
      style={{
        width: ANNOTATION_PRODUCTION_ROUTE_LAYOUT.surface.width,
        height: ANNOTATION_PRODUCTION_ROUTE_LAYOUT.surface.height,
      }}
      aria-label="生产线路"
    >
      <div className="dial-archive-production-routes__ghost" aria-hidden="true">
        PRODUCTION
      </div>
      <div className="dial-archive-production-routes__blade" aria-hidden="true">
        <span>03 / VECTOR 02</span>
        <b>ROUTE FIELD</b>
      </div>
      <div className="dial-archive-production-routes__fields" aria-hidden="true">
        {ANNOTATION_PRODUCTION_ROUTE_LAYOUT.fields.map((field) => (
          <section
            className={`dial-archive-production-routes__field is-${field.id}`}
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
      <div className="dial-archive-production-routes__contours" aria-hidden="true" />

      <svg
        className="dial-archive-production-routes__wiring"
        viewBox={`0 0 ${ANNOTATION_PRODUCTION_ROUTE_LAYOUT.viewBox.width} ${ANNOTATION_PRODUCTION_ROUTE_LAYOUT.viewBox.height}`}
        aria-hidden="true"
      >
        <g className="dial-archive-production-routes__decor">
          {ANNOTATION_PRODUCTION_ROUTE_LAYOUT.decorRoutes.map((_, index) => (
            <path d={productionDecorRoutePath(index)} key={index} />
          ))}
          <RouteGauge />
        </g>
        <g className="dial-archive-production-routes__main">
          {production.lanes.map((lane) => (
            <g
              className={`${lane.id === production.lane ? "is-active" : ""} is-${lane.state}`}
              key={lane.id}
            >
              <path className="is-route-bed" d={productionRoutePath(lane.id)} />
              <path className="is-route-signal" d={productionRoutePath(lane.id)} />
            </g>
          ))}
          {ANNOTATION_PRODUCTION_ROUTE_LAYOUT.junctions.map((junction, index) => (
            <g
              className="dial-archive-production-junction"
              transform={`translate(${junction.x} ${junction.y})`}
              key={index}
            >
              <rect x="-8" y="-8" width="16" height="16" />
              <circle r="3" />
            </g>
          ))}
        </g>
      </svg>

      <div
        className="dial-archive-production-source"
        style={productionNodeStyle(ANNOTATION_PRODUCTION_ROUTE_LAYOUT.source)}
      >
        <span className="dial-archive-production-node__corners" aria-hidden="true" />
        <span>RANGE EVIDENCE // SOURCE</span>
        <strong>{configuration.scopeCount.toLocaleString()}</strong>
        <small>MATERIAL IN SCOPE</small>
        <div aria-label="任务素材范围">
          <button
            className={configuration.scope === "all" ? "is-active" : undefined}
            type="button"
            disabled={Boolean(operation)}
            onClick={() => configuration.setScope("all")}
          >
            ALL <b>{configuration.totalCount.toLocaleString()}</b>
          </button>
          <button
            className={configuration.scope === "selected" ? "is-active" : undefined}
            type="button"
            disabled={Boolean(operation)}
            onClick={() => configuration.setScope("selected")}
          >
            RANGE <b>{configuration.selectedCount.toLocaleString()}</b>
          </button>
        </div>
      </div>

      <div className="dial-archive-production-lanes" role="tablist" aria-label="选择生产线路">
        {production.lanes.map((lane) => {
          const active = lane.id === production.lane;
          return (
            <button
              className={`dial-archive-production-lane is-${lane.id} is-${lane.state}${
                active ? " is-active" : ""
              }`}
              style={productionNodeStyle(ANNOTATION_PRODUCTION_ROUTE_LAYOUT.lanes[lane.id])}
              type="button"
              role="tab"
              aria-selected={active}
              aria-controls="annotation-production-console"
              onClick={() => onSelectLane(lane.id)}
              key={lane.id}
            >
              <span className="dial-archive-production-lane__visual">
                <span className="dial-archive-production-node__corners" aria-hidden="true" />
                <span className="dial-archive-production-lane__head">
                  <small>{lane.code}</small>
                  <i aria-hidden="true" />
                </span>
                <strong>{lane.title}</strong>
                <em>{lane.summary}</em>
                <span className="dial-archive-production-lane__reading">
                  <b>{lane.coveragePercent}%</b>
                  <i>{laneStateLabel(lane.state)}</i>
                </span>
              </span>
            </button>
          );
        })}
      </div>

      <button
        className={`dial-archive-production-terminal is-${operation?.tone ?? "configure"}`}
        style={productionNodeStyle(ANNOTATION_PRODUCTION_ROUTE_LAYOUT.terminal)}
        type="button"
        aria-label="打开生产执行检查器"
        onClick={onOpenInspector}
      >
        <span className="dial-archive-production-node__corners" aria-hidden="true" />
        <span>MERGE / COMMIT GATE</span>
        <small>{operation ? operation.id : "EXECUTION SNAPSHOT"}</small>
        <strong>
          {operation
            ? operation.statusLabel
            : configuration.ready
              ? "线路已经就绪"
              : "线路等待校验"}
        </strong>
        <output>{operation ? `${operation.progressPercent}%` : configuration.scopeCount}</output>
        <div aria-hidden="true">
          {Array.from({ length: 8 }, (_, index) => (
            <i
              className={
                operation
                  ? index < Math.ceil((operation.progressPercent / 100) * 8)
                    ? "is-filled"
                    : undefined
                  : configuration.ready && index < 3
                    ? "is-filled"
                    : undefined
              }
              key={index}
            />
          ))}
        </div>
      </button>
    </section>
  );
}
