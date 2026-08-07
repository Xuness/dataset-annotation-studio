import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";

import {
  PREPARATION_CANVAS_NODE_IDS,
  PREPARATION_CAPABILITY_IDS,
  type PreparationCanvasNodeId,
  type PreparationCapabilityId,
  type PreparationOperationSummary,
  type PreparationWorkbenchContent,
} from "../../../../pages/spaces/spacePageModel";
import { usePrefersReducedMotion } from "../../hooks/usePrefersReducedMotion";
import { PreparationInspector } from "./PreparationInspector";
import { usePreparationCanvasMotion } from "./hooks/usePreparationCanvasMotion";
import {
  PREPARATION_CANVAS_LAYOUT,
  createPreparationCanvasEdgePath,
  createPreparationCanvasPolylinePath,
  getPreparationCanvasNodeCenter,
  projectPreparationCanvasPointToMinimap,
  type PreparationCanvasEdge,
  type PreparationCanvasFieldId,
  type PreparationCanvasGauge,
  type PreparationCanvasRect,
} from "./model/preparationCanvasLayout";
import { PREPARATION_NODE_PRESENTATION } from "./model/preparationPresentation";

interface PreparationCanvasProps {
  content: PreparationWorkbenchContent;
}

interface NodeProgressStyle extends CSSProperties {
  "--dial-archive-node-progress": string;
  "--dial-archive-node-order": number;
  "--dial-archive-node-elevation": string;
}

interface EdgeOrderStyle extends CSSProperties {
  "--dial-archive-edge-order": number;
}

interface MinimapStyle extends CSSProperties {
  "--dial-archive-minimap-padding": string;
}

interface SurfaceStyle extends CSSProperties {
  "--dial-archive-grid-minor": string;
  "--dial-archive-grid-major": string;
}

function rectStyle(rect: PreparationCanvasRect): CSSProperties {
  return {
    top: rect.y,
    left: rect.x,
    width: rect.width,
    height: rect.height,
  };
}

function capabilityEnabled(content: PreparationWorkbenchContent, id: PreparationCapabilityId) {
  if (id === "geometry") return content.form.resizeEnabled;
  if (id === "encoding") return content.form.convertEnabled;
  return content.form.renameEnabled;
}

function capabilityParticipates(
  content: PreparationWorkbenchContent,
  operation: PreparationOperationSummary | null,
  id: PreparationCapabilityId,
) {
  return operation?.capabilities.includes(id) ?? capabilityEnabled(content, id);
}

function capabilitySummary(content: PreparationWorkbenchContent, id: PreparationCapabilityId) {
  if (id === "geometry") {
    return `${content.form.maxEdge}px · ${content.form.resizeAlgorithm.toUpperCase()}`;
  }
  if (id === "encoding") {
    return `${content.form.format.toUpperCase()} · Q${content.form.quality} · E${content.form.effort}`;
  }
  return `${content.form.renameTemplate} · ${content.form.renamePadding} DIGIT`;
}

interface CanvasNodeProps {
  id: PreparationCanvasNodeId;
  detail: string;
  active: boolean;
  selected: boolean;
  signaling: boolean;
  progress: number | null;
  status: string;
  onSelect(id: PreparationCanvasNodeId): void;
}

function CanvasNode({
  id,
  detail,
  active,
  selected,
  signaling,
  progress,
  status,
  onSelect,
}: CanvasNodeProps) {
  const { canvasCode: code, canvasTitle: title } = PREPARATION_NODE_PRESENTATION[id];
  const { rect, revealOrder, elevation } = PREPARATION_CANVAS_LAYOUT.nodes[id];
  return (
    <button
      className={`dial-archive-preparation-node is-${id}${active ? " is-active" : " is-bypassed"}${selected ? " is-selected" : ""}${signaling ? " is-signaling" : ""}`}
      type="button"
      aria-pressed={selected}
      aria-label={`检查节点 ${title}`}
      style={
        {
          ...rectStyle(rect),
          "--dial-archive-node-progress": `${progress ?? 0}%`,
          "--dial-archive-node-order": revealOrder,
          "--dial-archive-node-elevation": `${elevation}px`,
        } as NodeProgressStyle
      }
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
          {progress != null ? <strong>{progress}%</strong> : null}
        </span>
        <span className="dial-archive-preparation-node__meter" aria-hidden="true">
          <i />
        </span>
      </span>
    </button>
  );
}

function edgeIsActive(
  edge: PreparationCanvasEdge,
  participation: Readonly<Record<PreparationCapabilityId, boolean>>,
  previewReady: boolean,
  recoveryReady: boolean,
  hasOperation: boolean,
) {
  if (edge.activation === "always") return true;
  if (edge.activation === "transform") return Object.values(participation).some(Boolean);
  if (edge.activation === "preview") return previewReady || hasOperation;
  if (edge.activation === "recovery") return recoveryReady;
  return participation[edge.activation];
}

function edgeIsSignaling(
  edge: PreparationCanvasEdge,
  operation: PreparationOperationSummary | null,
) {
  if (!operation) return false;
  if (operation.status === "recovering") return edge.signal === "recovery";
  if (operation.status !== "running" || edge.signal !== "primary") return false;
  if (
    edge.activation === "geometry" ||
    edge.activation === "encoding" ||
    edge.activation === "identity"
  ) {
    return operation.capabilities.includes(edge.activation);
  }
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
  const ticks = [];
  for (let index = 0; index < gauge.tickCount; index += 1) {
    const major = index % gauge.majorEvery === 0;
    const inner = gauge.radius - (major ? gauge.tickLength * 1.9 : gauge.tickLength);
    const from = polarPoint(gauge.cx, gauge.cy, inner, (index / gauge.tickCount) * 360);
    const to = polarPoint(gauge.cx, gauge.cy, gauge.radius, (index / gauge.tickCount) * 360);
    ticks.push(
      <line
        className={major ? "is-major" : undefined}
        x1={from.x}
        y1={from.y}
        x2={to.x}
        y2={to.y}
        key={index}
      />,
    );
  }
  return <>{ticks}</>;
}

function Gauge({ gauge }: { gauge: PreparationCanvasGauge }) {
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

export function PreparationCanvas({ content }: PreparationCanvasProps) {
  const reducedMotion = usePrefersReducedMotion();
  const operation = content.selectedOperation ?? content.activeOperation;
  const operationId = operation?.id ?? null;
  const operationFocus: PreparationCanvasNodeId =
    content.initialFocus === "recovery" || operation?.status === "recovering"
      ? "recovery"
      : "commit";
  const requestedFocus = operationId ? operationFocus : content.initialFocus;
  const requestedFocusKey = operationId
    ? `operation:${operationId}:${requestedFocus}`
    : `entry:${requestedFocus}`;
  const [selectedNode, setSelectedNode] = useState<PreparationCanvasNodeId>(() => requestedFocus);
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const inspectorRef = useRef<HTMLElement>(null);
  const appliedFocusRequestRef = useRef<string | null>(null);
  const motion = usePreparationCanvasMotion({
    reducedMotion,
    occlusionRef: inspectorRef,
    occlusionActive: inspectorOpen,
  });
  const { focusAt } = motion;

  useEffect(() => {
    if (appliedFocusRequestRef.current === requestedFocusKey) return;
    appliedFocusRequestRef.current = requestedFocusKey;
    setSelectedNode(requestedFocus);
    setInspectorOpen(true);
    const center = getPreparationCanvasNodeCenter(requestedFocus);
    focusAt(center.x, center.y);
  }, [focusAt, requestedFocus, requestedFocusKey]);

  const participation = useMemo(
    () => ({
      geometry: capabilityParticipates(content, operation, "geometry"),
      encoding: capabilityParticipates(content, operation, "encoding"),
      identity: capabilityParticipates(content, operation, "identity"),
    }),
    [content, operation],
  );
  const participatingCapabilities = PREPARATION_CAPABILITY_IDS.filter(
    (capability) => participation[capability],
  );
  const sharedProgress = operation?.status === "running" ? operation.progressPercent : null;
  const recoveryProgress = operation?.status === "recovering" ? operation.progressPercent : null;
  const scopeDetail =
    content.form.scope === "selected"
      ? `${content.checkedCount} SELECTED ASSETS`
      : content.form.scope === "folder"
        ? `${content.scopeCount} BRANCH ASSETS`
        : `${content.assetCount} PROJECT ASSETS`;
  const previewReady = Boolean(content.preview);
  const recoveryReady = Boolean(operation?.canRecover || operation?.status === "recovering");

  const selectNode = (id: PreparationCanvasNodeId) => {
    setSelectedNode(id);
    setInspectorOpen(true);
    const center = getPreparationCanvasNodeCenter(id);
    focusAt(center.x, center.y);
  };

  const {
    surface,
    edges,
    junctions,
    fields,
    decorRoutes,
    backgroundFrames,
    landmarks,
    gauges,
    grid,
    minimap,
  } = PREPARATION_CANVAS_LAYOUT;
  const minimapStyle = {
    width: minimap.width,
    height: minimap.height,
    "--dial-archive-minimap-padding": `${minimap.padding}px`,
  } as MinimapStyle;
  const surfaceStyle = {
    width: surface.width,
    height: surface.height,
    "--dial-archive-grid-minor": `${grid.minor}px`,
    "--dial-archive-grid-major": `${grid.major}px`,
  } as SurfaceStyle;

  const fieldReadings: Readonly<Record<PreparationCanvasFieldId, string>> = {
    input: `${content.scopeCount} ROUTED / ${content.checkedCount} CHECKED`,
    transform: `${participatingCapabilities.length} / ${PREPARATION_CAPABILITY_IDS.length} ACTIVE`,
    verify: content.preview
      ? `${content.preview.changedCount} DELTA / ${content.preview.warningCount} WARN`
      : "PROJECTION NOT LOADED",
    trace: operation
      ? `${operation.statusLabel.toUpperCase()} / ${operation.progressPercent}%`
      : "NO OPERATION RECORD",
  };

  const resolveEdgeActive = (edge: PreparationCanvasEdge) =>
    edgeIsActive(edge, participation, previewReady, recoveryReady, Boolean(operation));

  return (
    <div className="dial-archive-preparation-canvas-shell">
      <div
        className="dial-archive-preparation-canvas"
        ref={motion.viewportRef}
        role="region"
        aria-label="可拖动的整备任务画布"
        tabIndex={0}
        onPointerDown={motion.onPointerDown}
        onPointerMove={motion.onPointerMove}
        onPointerUp={motion.onPointerUp}
        onPointerCancel={motion.onPointerCancel}
        onWheel={motion.onWheel}
        onKeyDown={motion.onKeyDown}
      >
        <div className="dial-archive-preparation-canvas__help">
          <span>DRAG BLANK FIELD TO PAN</span>
          <span>WHEEL TO SCALE</span>
          <span>SHIFT + WHEEL TO TRACK</span>
          <span>0 // FIT TO TASK</span>
        </div>
        <div
          className="dial-archive-preparation-canvas__surface"
          ref={motion.surfaceRef}
          style={surfaceStyle}
        >
          <div
            className="dial-archive-preparation-canvas__scene"
            ref={motion.sceneRef}
            style={surfaceStyle}
          >
            <div
              className="dial-archive-preparation-canvas__ghost-word"
              style={{ top: landmarks.ghostWord.y, left: landmarks.ghostWord.x }}
              aria-hidden="true"
            >
              OPERATION
            </div>
            <div className="dial-archive-preparation-canvas__fields" aria-hidden="true">
              {fields.map((field) => (
                <section
                  className={`dial-archive-preparation-canvas__field is-${field.id} is-${field.axis}`}
                  style={rectStyle(field.rect)}
                  key={field.id}
                >
                  <span>{field.index}</span>
                  <div>
                    <small>{field.kicker}</small>
                    <b>{field.title}</b>
                  </div>
                  <output>{fieldReadings[field.id]}</output>
                </section>
              ))}
            </div>
            <div className="dial-archive-preparation-canvas__background" aria-hidden="true">
              {content.samples.slice(0, backgroundFrames.length).map((sample, index) => {
                const frame = backgroundFrames[index];
                return (
                  <figure
                    className={`dial-archive-preparation-canvas__frame is-${frame.id}`}
                    style={rectStyle(frame.rect)}
                    key={sample.id}
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
                      <span>{frame.code}</span>
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
              style={rectStyle(landmarks.contours)}
              aria-hidden="true"
            />

            <svg
              className="dial-archive-preparation-connectors"
              viewBox={`0 0 ${surface.width} ${surface.height}`}
              aria-hidden="true"
            >
              <g className="dial-archive-preparation-connectors__decor">
                {decorRoutes.map((route, index) => (
                  <path d={createPreparationCanvasPolylinePath(route)} key={index} />
                ))}
              </g>
              <g className="dial-archive-preparation-connectors__gauges">
                {gauges.map((gauge) => (
                  <Gauge gauge={gauge} key={gauge.id} />
                ))}
              </g>
              <g className="dial-archive-preparation-connectors__main">
                {edges.map((edge, index) => (
                  <path
                    className={`${edge.signal === "recovery" ? "is-recovery " : ""}${resolveEdgeActive(edge) ? "is-active" : "is-bypassed"}`}
                    style={{ "--dial-archive-edge-order": index } as EdgeOrderStyle}
                    d={createPreparationCanvasEdgePath(edge)}
                    data-edge-id={edge.id}
                    key={edge.id}
                  />
                ))}
              </g>
              <g className="dial-archive-preparation-connectors__junctions">
                {Object.values(junctions).map((junction) => {
                  const active =
                    junction.activation === "always" || participatingCapabilities.length > 0;
                  return (
                    <g
                      className={`is-${junction.kind} ${active ? "is-active" : "is-bypassed"}`}
                      transform={`translate(${junction.point.x} ${junction.point.y})`}
                      data-junction-id={junction.id}
                      key={junction.id}
                    >
                      <rect x={-7} y={-7} width={14} height={14} transform="rotate(45)" />
                      <circle r={2.2} />
                    </g>
                  );
                })}
              </g>
              {operation?.status === "running" || operation?.status === "recovering" ? (
                <g className="dial-archive-preparation-connectors__signal">
                  {edges
                    .filter((edge) => edgeIsSignaling(edge, operation))
                    .map((edge) => (
                      <path
                        className={edge.signal === "recovery" ? "is-recovery" : undefined}
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
              style={rectStyle(landmarks.fusionLabel)}
              aria-hidden="true"
            >
              <span>PARALLEL TRANSFORM FIELD</span>
              <b>{participatingCapabilities.length > 1 ? "FUSED / SHARED PASS" : "SINGLE PASS"}</b>
            </div>

            <CanvasNode
              id="source"
              detail={content.project?.name ?? "NO PROJECT"}
              active={Boolean(content.project)}
              selected={selectedNode === "source"}
              signaling={false}
              progress={null}
              status={operation ? "LOCKED" : "READY"}
              onSelect={selectNode}
            />
            <CanvasNode
              id="scope"
              detail={scopeDetail}
              active
              selected={selectedNode === "scope"}
              signaling={false}
              progress={null}
              status={operation ? "LOCKED" : "CONFIGURE"}
              onSelect={selectNode}
            />
            {PREPARATION_CAPABILITY_IDS.map((capability) => {
              const participates = participation[capability];
              return (
                <CanvasNode
                  id={capability}
                  detail={
                    operation
                      ? operation.optionSummary.join(" // ")
                      : capabilitySummary(content, capability)
                  }
                  active={participates}
                  selected={selectedNode === capability}
                  signaling={participates && sharedProgress != null}
                  progress={participates ? sharedProgress : null}
                  status={
                    participates
                      ? sharedProgress != null
                        ? "SHARED PASS"
                        : operation
                          ? operation.statusLabel.toUpperCase()
                          : "ARMED"
                      : "BYPASSED"
                  }
                  onSelect={selectNode}
                  key={capability}
                />
              );
            })}
            <CanvasNode
              id="preview"
              detail={
                content.preview
                  ? `${content.preview.changedCount} CHANGE · ${content.preview.warningCount} WARN`
                  : "PREVIEW REQUIRED"
              }
              active={previewReady || Boolean(operation)}
              selected={selectedNode === "preview"}
              signaling={false}
              progress={null}
              status={operation ? "LOCKED" : previewReady ? "VALID" : "UNLOADED"}
              onSelect={selectNode}
            />
            <CanvasNode
              id="commit"
              detail={operation?.currentRelativePath ?? operation?.stageLabel ?? "AWAITING PREVIEW"}
              active={Boolean(operation || content.preview)}
              selected={selectedNode === "commit"}
              signaling={operation?.status === "running"}
              progress={operation ? operation.progressPercent : null}
              status={
                operation?.statusLabel.toUpperCase() ?? (content.preview ? "ARMED" : "LOCKED")
              }
              onSelect={selectNode}
            />
            <CanvasNode
              id="recovery"
              detail={operation?.id ?? "NO OPERATION RECORD"}
              active={recoveryReady}
              selected={selectedNode === "recovery"}
              signaling={operation?.status === "recovering"}
              progress={recoveryProgress}
              status={
                operation?.status === "recovering"
                  ? "REVERSING"
                  : recoveryReady
                    ? "AVAILABLE"
                    : "STANDBY"
              }
              onSelect={selectNode}
            />
          </div>
        </div>

        <div className="dial-archive-preparation-canvas__controls" aria-label="画布视图控制">
          <button type="button" aria-label="缩小画布" onClick={motion.zoomOut}>
            −
          </button>
          <output ref={motion.scaleReadoutRef}>100%</output>
          <button type="button" aria-label="放大画布" onClick={motion.zoomIn}>
            ＋
          </button>
          <button type="button" onClick={() => motion.fit()}>
            FIT TO TASK
          </button>
        </div>

        <div className="dial-archive-preparation-minimap" style={minimapStyle} aria-hidden="true">
          {PREPARATION_CANVAS_NODE_IDS.map((node) => {
            const point = projectPreparationCanvasPointToMinimap(
              getPreparationCanvasNodeCenter(node),
            );
            return (
              <span
                className={selectedNode === node ? "is-selected" : undefined}
                style={{
                  top: point.y - minimap.markerHeight / 2,
                  left: point.x - minimap.markerWidth / 2,
                  width: minimap.markerWidth,
                  height: minimap.markerHeight,
                }}
                data-node-id={node}
                key={node}
              />
            );
          })}
          <i ref={motion.minimapViewportRef} />
        </div>
      </div>

      {inspectorOpen ? (
        <PreparationInspector
          ref={inspectorRef}
          content={content}
          node={selectedNode}
          onClose={() => setInspectorOpen(false)}
        />
      ) : (
        <button
          className="dial-archive-preparation-inspector-reopen"
          type="button"
          onClick={() => setInspectorOpen(true)}
        >
          INSPECT {selectedNode.toUpperCase()} →
        </button>
      )}
    </div>
  );
}
