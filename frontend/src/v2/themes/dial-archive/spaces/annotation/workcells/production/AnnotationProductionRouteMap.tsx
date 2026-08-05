import type { CSSProperties } from "react";

import type {
  AnnotationLaneId,
  AnnotationProductionContent,
  AnnotationStageAsset,
} from "../../../../../../pages/spaces/spacePageModel";
import {
  createPreparationCanvasEdgePath,
  createPreparationCanvasPolylinePath,
  type PreparationCanvasEdge,
  type PreparationCanvasGauge,
} from "../../../preparation/model/preparationCanvasLayout";
import {
  ANNOTATION_PRODUCTION_ROUTE_LAYOUT,
  isProductionLaneNode,
  productionNodeStyle,
  type ProductionCanvasNodeId,
} from "./model/annotationProductionLayout";

interface AnnotationProductionRouteMapProps {
  asset: AnnotationStageAsset | null;
  assets: readonly AnnotationStageAsset[];
  production: AnnotationProductionContent;
  selectedNode: ProductionCanvasNodeId;
  onSelectNode(node: ProductionCanvasNodeId): void;
}

interface ProductionNodeProgressStyle extends CSSProperties {
  "--dial-archive-node-progress": string;
}

interface ProductionEdgeOrderStyle extends CSSProperties {
  "--dial-archive-edge-order": number;
}

interface ProductionCanvasNodeProps {
  id: ProductionCanvasNodeId;
  code: string;
  title: string;
  detail: string;
  active: boolean;
  selected: boolean;
  signaling?: boolean;
  progress?: number | null;
  status: string;
  reading?: string | number | null;
  ariaLabel?: string;
  onSelect(node: ProductionCanvasNodeId): void;
}

const PRODUCTION_FIELD_COPY = {
  input: { kicker: "SOURCE EVIDENCE", title: "INPUT / SCOPE" },
  transform: { kicker: "PARALLEL PRODUCTION FIELD", title: "ANNOTATION ARRAY" },
  verify: { kicker: "EXECUTION PROJECTION", title: "VERIFY / COMMIT" },
  trace: { kicker: "OUTPUT VERSION TRACE", title: "RESULT LINE" },
} as const;

const PRODUCTION_FRAME_CODES = [
  "SOURCE / EVIDENCE",
  "TAGS / SIGNAL",
  "DESCRIPTION / CONTEXT",
  "TRANSLATION / TARGET",
  "COMMIT / WRITE",
] as const;

function laneStateLabel(state: AnnotationProductionContent["lanes"][number]["state"]): string {
  if (state === "running") return "LIVE";
  if (state === "complete") return "COMPLETE";
  if (state === "ready") return "READY";
  if (state === "attention") return "ATTENTION";
  return "STANDBY";
}

function productionEvidenceAssets(
  asset: AnnotationStageAsset | null,
  assets: readonly AnnotationStageAsset[],
): readonly AnnotationStageAsset[] {
  if (!asset) return assets.slice(0, PRODUCTION_FRAME_CODES.length);
  return [asset, ...assets.filter((candidate) => candidate.id !== asset.id)].slice(
    0,
    PRODUCTION_FRAME_CODES.length,
  );
}

function laneForEdge(edge: PreparationCanvasEdge): AnnotationLaneId | null {
  if (edge.activation === "geometry") return "tags";
  if (edge.activation === "encoding") return "description";
  if (edge.activation === "identity") return "translation";
  return null;
}

function edgeIsActive(
  edge: PreparationCanvasEdge,
  production: AnnotationProductionContent,
): boolean {
  const lane = laneForEdge(edge);
  if (lane) return lane === production.lane;
  if (edge.activation === "preview") {
    return production.configuration.ready || Boolean(production.operation);
  }
  if (edge.activation === "recovery") return Boolean(production.operation);
  return true;
}

function edgeIsSignaling(
  edge: PreparationCanvasEdge,
  signalingLane: AnnotationLaneId | null,
): boolean {
  if (!signalingLane) return false;
  const lane = laneForEdge(edge);
  if (lane) return lane === signalingLane;
  if (edge.activation === "recovery") return false;
  return (
    edge.activation === "always" || edge.activation === "transform" || edge.activation === "preview"
  );
}

function polarPoint(cx: number, cy: number, radius: number, degrees: number) {
  const angle = ((degrees - 90) * Math.PI) / 180;
  return {
    x: cx + radius * Math.cos(angle),
    y: cy + radius * Math.sin(angle),
  };
}

function GaugeTicks({ gauge }: { gauge: PreparationCanvasGauge }) {
  return (
    <>
      {Array.from({ length: gauge.tickCount }, (_, index) => {
        const major = index % gauge.majorEvery === 0;
        const inner = gauge.radius - (major ? gauge.tickLength * 1.9 : gauge.tickLength);
        const from = polarPoint(gauge.cx, gauge.cy, inner, (index / gauge.tickCount) * 360);
        const to = polarPoint(gauge.cx, gauge.cy, gauge.radius, (index / gauge.tickCount) * 360);
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
    </>
  );
}

function ProductionGauge({ gauge }: { gauge: PreparationCanvasGauge }) {
  const crosshairLength = gauge.radius * 1.2;
  return (
    <g className={`dial-archive-preparation-gauge is-${gauge.id}`}>
      {gauge.crosshair ? (
        <g className="dial-archive-preparation-gauge__crosshair">
          <line
            x1={gauge.cx - crosshairLength}
            y1={gauge.cy}
            x2={gauge.cx + crosshairLength}
            y2={gauge.cy}
          />
          <line
            x1={gauge.cx}
            y1={gauge.cy - crosshairLength}
            x2={gauge.cx}
            y2={gauge.cy + crosshairLength}
          />
          <rect
            x={gauge.cx - 4}
            y={gauge.cy - 4}
            width={8}
            height={8}
            transform={`rotate(45 ${gauge.cx} ${gauge.cy})`}
          />
        </g>
      ) : null}
      <circle
        className="dial-archive-preparation-gauge__ring"
        cx={gauge.cx}
        cy={gauge.cy}
        r={gauge.radius}
      />
      <g
        className="dial-archive-preparation-gauge__rotor"
        style={{
          transformOrigin: `${gauge.cx}px ${gauge.cy}px`,
          animationDuration: `${gauge.spinSeconds}s`,
        }}
      >
        <GaugeTicks gauge={gauge} />
        {gauge.accentArcs.map((arc) => {
          const from = polarPoint(gauge.cx, gauge.cy, gauge.radius, arc.start);
          const to = polarPoint(gauge.cx, gauge.cy, gauge.radius, arc.end);
          const largeArc = arc.end - arc.start > 180 ? 1 : 0;
          return (
            <g className="dial-archive-preparation-gauge__arc" key={`${arc.start}-${arc.end}`}>
              <path
                d={`M ${from.x.toFixed(2)} ${from.y.toFixed(2)} A ${gauge.radius} ${gauge.radius} 0 ${largeArc} 1 ${to.x.toFixed(2)} ${to.y.toFixed(2)}`}
              />
              <rect
                x={to.x - 4}
                y={to.y - 4}
                width={8}
                height={8}
                transform={`rotate(45 ${to.x} ${to.y})`}
              />
            </g>
          );
        })}
      </g>
    </g>
  );
}

function ProductionCanvasNode({
  id,
  code,
  title,
  detail,
  active,
  selected,
  signaling = false,
  progress = null,
  status,
  reading = null,
  ariaLabel,
  onSelect,
}: ProductionCanvasNodeProps) {
  const laneNode = isProductionLaneNode(id);
  return (
    <button
      className={`dial-archive-production-canvas-node dial-archive-preparation-node is-${id}${
        active ? " is-active" : " is-bypassed"
      }${selected ? " is-selected" : ""}${signaling ? " is-signaling" : ""}`}
      style={
        {
          ...productionNodeStyle(id),
          "--dial-archive-node-progress": `${progress ?? 0}%`,
        } as ProductionNodeProgressStyle
      }
      type="button"
      role={laneNode ? "tab" : undefined}
      aria-selected={laneNode ? active : undefined}
      aria-pressed={laneNode ? undefined : selected}
      aria-controls={laneNode ? "annotation-production-inspector" : undefined}
      aria-label={ariaLabel ?? `检查生产节点 ${title}`}
      onClick={() => onSelect(id)}
    >
      <span className="dial-archive-preparation-node__visual">
        <span className="dial-archive-preparation-node__corners" aria-hidden="true" />
        <span className="dial-archive-preparation-node__head">
          <em>{title}</em>
          <i className="dial-archive-preparation-node__lamp" aria-hidden="true" />
        </span>
        <b className="dial-archive-preparation-node__code">{code}</b>
        <small>{detail}</small>
        <span className="dial-archive-preparation-node__status">
          {status}
          {reading != null ? <strong>{reading}</strong> : null}
        </span>
        <span className="dial-archive-preparation-node__meter" aria-hidden="true">
          <i />
        </span>
      </span>
    </button>
  );
}

export function AnnotationProductionRouteMap({
  asset,
  assets,
  production,
  selectedNode,
  onSelectNode,
}: AnnotationProductionRouteMapProps) {
  const { configuration, operation } = production;
  const layout = ANNOTATION_PRODUCTION_ROUTE_LAYOUT;
  const routeCount = production.lanes.filter((lane) => lane.state !== "inactive").length;
  const evidenceAssets = productionEvidenceAssets(asset, assets);
  const signalingLane =
    production.lanes.find((lane) => lane.state === "running")?.id ??
    (operation?.tone === "active" ? operation.lane : null);
  const fieldReadings = {
    input: `${configuration.scopeCount.toLocaleString()} MATERIAL / ${configuration.selectedCount.toLocaleString()} CHECKED`,
    transform: `${routeCount || 1} / 3 COVERED`,
    verify: operation
      ? `${operation.statusLabel.toUpperCase()} / ${operation.progressPercent}%`
      : configuration.ready
        ? "ROUTE VALID / SNAPSHOT ARMED"
        : `${configuration.blockers.length} INTERLOCK`,
    trace: operation
      ? `${operation.outputChannel.toUpperCase()} / ${operation.statusLabel.toUpperCase()}`
      : "NO OPERATION RECORD",
  } as const;

  return (
    <section
      className={`dial-archive-production-canvas-map is-${production.lane}`}
      style={{ width: layout.surface.width, height: layout.surface.height }}
      aria-label="生产线路"
      data-canvas-parity="space-02"
    >
      <div
        className="dial-archive-preparation-canvas__ghost-word"
        style={{ top: layout.landmarks.ghostWord.y, left: layout.landmarks.ghostWord.x }}
        aria-hidden="true"
      >
        OPERATION
      </div>

      <div className="dial-archive-preparation-canvas__fields" aria-hidden="true">
        {layout.fields.map((field) => (
          <section
            className={`dial-archive-preparation-canvas__field is-${field.id} is-${field.axis}`}
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
              <small>{PRODUCTION_FIELD_COPY[field.id].kicker}</small>
              <b>{PRODUCTION_FIELD_COPY[field.id].title}</b>
            </div>
            <output>{fieldReadings[field.id]}</output>
          </section>
        ))}
      </div>

      <div className="dial-archive-preparation-canvas__background" aria-hidden="true">
        {layout.backgroundFrames.map((frame, index) => {
          const sample = evidenceAssets[index % Math.max(1, evidenceAssets.length)];
          if (!sample) return null;
          return (
            <figure
              className={`dial-archive-preparation-canvas__frame is-${frame.id}`}
              style={{
                top: frame.rect.y,
                left: frame.rect.x,
                width: frame.rect.width,
                height: frame.rect.height,
              }}
              key={`${frame.id}:${sample.id}`}
            >
              <img
                src={sample.thumbnailUrl}
                alt=""
                draggable={false}
                style={{
                  clipPath: frame.clipPath ?? undefined,
                  opacity: frame.opacity,
                }}
              />
              <figcaption>
                <span>{PRODUCTION_FRAME_CODES[index]}</span>
                <b>
                  {sample.width} × {sample.height}
                </b>
                <small>{sample.filename}</small>
              </figcaption>
            </figure>
          );
        })}
      </div>

      <div
        className="dial-archive-preparation-canvas__contours"
        style={{
          top: layout.landmarks.contours.y,
          left: layout.landmarks.contours.x,
          width: layout.landmarks.contours.width,
          height: layout.landmarks.contours.height,
        }}
        aria-hidden="true"
      />

      <svg
        className="dial-archive-preparation-connectors"
        viewBox={`0 0 ${layout.surface.width} ${layout.surface.height}`}
        aria-hidden="true"
      >
        <g className="dial-archive-preparation-connectors__decor">
          {layout.decorRoutes.map((route, index) => (
            <path d={createPreparationCanvasPolylinePath(route)} key={index} />
          ))}
        </g>
        <g className="dial-archive-preparation-connectors__gauges">
          {layout.gauges.map((gauge) => (
            <ProductionGauge gauge={gauge} key={gauge.id} />
          ))}
        </g>
        <g className="dial-archive-preparation-connectors__main">
          {layout.edges.map((edge, index) => (
            <path
              className={`${edge.activation === "recovery" ? "is-recovery " : ""}${
                edgeIsActive(edge, production) ? "is-active" : "is-bypassed"
              }`}
              style={{ "--dial-archive-edge-order": index } as ProductionEdgeOrderStyle}
              d={createPreparationCanvasEdgePath(edge)}
              data-edge-id={edge.id}
              key={edge.id}
            />
          ))}
        </g>
        <g className="dial-archive-preparation-connectors__junctions">
          {Object.values(layout.junctions).map((junction) => (
            <g
              className={`is-${junction.kind} is-active`}
              transform={`translate(${junction.point.x} ${junction.point.y})`}
              data-junction-id={junction.id}
              key={junction.id}
            >
              <rect x={-7} y={-7} width={14} height={14} transform="rotate(45)" />
              <circle r={2.2} />
            </g>
          ))}
        </g>
        {signalingLane ? (
          <g className="dial-archive-preparation-connectors__signal">
            {layout.edges
              .filter((edge) => edgeIsSignaling(edge, signalingLane))
              .map((edge) => (
                <path
                  d={createPreparationCanvasEdgePath(edge)}
                  data-edge-id={edge.id}
                  key={edge.id}
                />
              ))}
          </g>
        ) : null}
      </svg>

      <div
        className="dial-archive-preparation-fusion-label"
        style={{
          top: layout.landmarks.fusionLabel.y,
          left: layout.landmarks.fusionLabel.x,
          width: layout.landmarks.fusionLabel.width,
          height: layout.landmarks.fusionLabel.height,
        }}
        aria-hidden="true"
      >
        <span>PARALLEL ANNOTATION FIELD</span>
        <b>{routeCount > 1 ? "FUSED / SHARED SOURCE" : "SINGLE ROUTE"}</b>
      </div>

      <ProductionCanvasNode
        id="source"
        code="SRC / 00"
        title="当前素材"
        detail={asset?.filename ?? "NO MATERIAL EVIDENCE"}
        active={Boolean(asset)}
        selected={selectedNode === "source"}
        status={operation ? "LOCKED" : "READY"}
        onSelect={onSelectNode}
      />

      <div
        className={`dial-archive-production-canvas-node dial-archive-production-canvas-scope dial-archive-preparation-node is-active${
          selectedNode === "scope" ? " is-selected" : ""
        }`}
        style={
          {
            ...productionNodeStyle("scope"),
            "--dial-archive-node-progress": "100%",
          } as ProductionNodeProgressStyle
        }
        role="group"
        aria-label="任务素材范围"
        aria-current={selectedNode === "scope" ? "step" : undefined}
        tabIndex={0}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={() => onSelectNode("scope")}
        onKeyDown={(event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          onSelectNode("scope");
        }}
      >
        <span className="dial-archive-preparation-node__visual">
          <span className="dial-archive-preparation-node__corners" aria-hidden="true" />
          <span className="dial-archive-preparation-node__head">
            <em>处理范围</em>
            <i className="dial-archive-preparation-node__lamp" aria-hidden="true" />
          </span>
          <b className="dial-archive-preparation-node__code">SCP / 01</b>
          <small>{configuration.scopeCount.toLocaleString()} MATERIAL IN SCOPE</small>
          <span className="dial-archive-preparation-node__status dial-archive-production-canvas-scope__options">
            <button
              className={configuration.scope === "all" ? "is-active" : undefined}
              type="button"
              disabled={Boolean(operation)}
              onClick={(event) => {
                event.stopPropagation();
                onSelectNode("scope");
                configuration.setScope("all");
              }}
            >
              ALL {configuration.totalCount.toLocaleString()}
            </button>
            <button
              className={configuration.scope === "selected" ? "is-active" : undefined}
              type="button"
              disabled={Boolean(operation)}
              onClick={(event) => {
                event.stopPropagation();
                onSelectNode("scope");
                configuration.setScope("selected");
              }}
            >
              SEL {configuration.selectedCount.toLocaleString()}
            </button>
            <button
              className={configuration.scope === "folder" ? "is-active" : undefined}
              type="button"
              disabled={Boolean(operation) || configuration.folderOptions.length === 0}
              onClick={(event) => {
                event.stopPropagation();
                onSelectNode("scope");
                configuration.setScope("folder");
              }}
            >
              DIR {configuration.folderOptions.length.toLocaleString()}
            </button>
          </span>
          <span className="dial-archive-preparation-node__meter" aria-hidden="true">
            <i />
          </span>
        </span>
      </div>

      {production.lanes.map((lane) => {
        const active = lane.id === production.lane;
        return (
          <ProductionCanvasNode
            id={lane.id}
            code={lane.code}
            title={lane.title}
            detail={lane.summary}
            active={active}
            selected={selectedNode === lane.id}
            signaling={lane.state === "running"}
            progress={active ? lane.coveragePercent : null}
            status={laneStateLabel(lane.state)}
            reading={`${lane.coveragePercent}%`}
            onSelect={onSelectNode}
            key={lane.id}
          />
        );
      })}

      <ProductionCanvasNode
        id="validation"
        code="PRV / 04"
        title="路线校验"
        detail={
          configuration.ready
            ? `${configuration.snapshot.length} SNAPSHOT READINGS`
            : `${configuration.blockers.length} INTERLOCK`
        }
        active={configuration.ready || Boolean(operation)}
        selected={selectedNode === "validation"}
        status={operation ? "LOCKED" : configuration.ready ? "VALID" : "UNLOADED"}
        onSelect={onSelectNode}
      />

      <ProductionCanvasNode
        id="terminal"
        code="CMT / 05"
        title="合流写入"
        detail={operation?.id ?? "EXECUTION SNAPSHOT"}
        active={configuration.ready || Boolean(operation)}
        selected={selectedNode === "terminal"}
        signaling={operation?.tone === "active"}
        progress={operation?.progressPercent ?? (configuration.ready ? 32 : null)}
        status={
          operation ? operation.statusLabel.toUpperCase() : configuration.ready ? "ARMED" : "LOCKED"
        }
        reading={operation ? `${operation.progressPercent}%` : configuration.scopeCount}
        ariaLabel="打开合流写入检查器"
        onSelect={onSelectNode}
      />

      <ProductionCanvasNode
        id="result"
        code="RES / 06"
        title="执行结果"
        detail={operation?.outputChannel ?? "NO OPERATION RECORD"}
        active={Boolean(operation)}
        selected={selectedNode === "result"}
        signaling={operation?.tone === "active"}
        progress={operation?.progressPercent ?? null}
        status={operation ? operation.statusLabel.toUpperCase() : "STANDBY"}
        reading={operation ? `${operation.succeeded}/${operation.total}` : null}
        onSelect={onSelectNode}
      />
    </section>
  );
}
