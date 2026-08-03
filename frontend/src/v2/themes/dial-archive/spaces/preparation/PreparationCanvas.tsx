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
  getPreparationCanvasNodeCenter,
  projectPreparationCanvasPointToMinimap,
  type PreparationCanvasEdge,
  type PreparationCanvasRect,
} from "./model/preparationCanvasLayout";
import { PREPARATION_NODE_PRESENTATION } from "./model/preparationPresentation";

interface PreparationCanvasProps {
  content: PreparationWorkbenchContent;
}

interface NodeProgressStyle extends CSSProperties {
  "--dial-archive-node-progress": string;
}

interface MinimapStyle extends CSSProperties {
  "--dial-archive-minimap-padding": string;
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
  progress: number | null;
  status: string;
  onSelect(id: PreparationCanvasNodeId): void;
}

function CanvasNode({ id, detail, active, selected, progress, status, onSelect }: CanvasNodeProps) {
  const { canvasCode: code, canvasTitle: title } = PREPARATION_NODE_PRESENTATION[id];
  const { rect } = PREPARATION_CANVAS_LAYOUT.nodes[id];
  return (
    <button
      className={`dial-archive-preparation-node is-${id}${active ? " is-active" : " is-bypassed"}${selected ? " is-selected" : ""}`}
      type="button"
      aria-pressed={selected}
      aria-label={`检查节点 ${title}`}
      style={
        {
          ...rectStyle(rect),
          "--dial-archive-node-progress": `${progress ?? 0}%`,
        } as NodeProgressStyle
      }
      onClick={() => onSelect(id)}
    >
      <span className="dial-archive-preparation-node__visual">
        <span className="dial-archive-preparation-node__head">
          <em>{code}</em>
          <i aria-hidden="true" />
        </span>
        <b>{title}</b>
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
  return edge.activation === "always" || edge.activation === "preview";
}

export function PreparationCanvas({ content }: PreparationCanvasProps) {
  const reducedMotion = usePrefersReducedMotion();
  const operation = content.selectedOperation ?? content.activeOperation;
  const operationId = operation?.id ?? null;
  const operationFocus: PreparationCanvasNodeId =
    content.initialFocus === "recovery" || operation?.status === "recovering"
      ? "recovery"
      : "commit";
  const [selectedNode, setSelectedNode] = useState<PreparationCanvasNodeId>(() =>
    operation ? operationFocus : content.initialFocus,
  );
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const inspectorRef = useRef<HTMLElement>(null);
  const motion = usePreparationCanvasMotion({
    reducedMotion,
    occlusionRef: inspectorRef,
    occlusionActive: inspectorOpen,
  });
  const { focusAt } = motion;

  useEffect(() => {
    const nextNode = operationId ? operationFocus : content.initialFocus;
    setSelectedNode(nextNode);
    setInspectorOpen(true);
    const center = getPreparationCanvasNodeCenter(nextNode);
    focusAt(center.x, center.y);
  }, [content.initialFocus, focusAt, operationFocus, operationId]);

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
      : `${content.assetCount} PROJECT ASSETS`;
  const previewReady = Boolean(content.preview);
  const recoveryReady = Boolean(operation?.canRecover || operation?.status === "recovering");

  const selectNode = (id: PreparationCanvasNodeId) => {
    setSelectedNode(id);
    setInspectorOpen(true);
    const center = getPreparationCanvasNodeCenter(id);
    focusAt(center.x, center.y);
  };

  const { surface, edges, decorPaths, backgroundFrames, landmarks, minimap } =
    PREPARATION_CANVAS_LAYOUT;
  const minimapStyle = {
    width: minimap.width,
    height: minimap.height,
    "--dial-archive-minimap-padding": `${minimap.padding}px`,
  } as MinimapStyle;

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
          <span>CTRL + WHEEL TO SCALE</span>
          <span>0 // FIT TO TASK</span>
        </div>
        <div
          className="dial-archive-preparation-canvas__surface"
          ref={motion.surfaceRef}
          style={{ width: surface.width, height: surface.height }}
        >
          <div
            className="dial-archive-preparation-canvas__ghost-word"
            style={{ top: landmarks.ghostWord.y, left: landmarks.ghostWord.x }}
            aria-hidden="true"
          >
            OPERATION
          </div>
          <div className="dial-archive-preparation-canvas__background" aria-hidden="true">
            {content.samples.slice(0, backgroundFrames.length).map((sample, index) => {
              const frame = backgroundFrames[index];
              return (
                <img
                  src={sample.thumbnailUrl}
                  alt=""
                  draggable={false}
                  style={{
                    ...rectStyle(frame.rect),
                    clipPath: frame.clipPath ?? undefined,
                    opacity: frame.opacity,
                  }}
                  key={sample.id}
                />
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
              {decorPaths.map((path) => (
                <path d={path} key={path} />
              ))}
            </g>
            <g className="dial-archive-preparation-connectors__main">
              {edges.map((edge) => {
                const active = edgeIsActive(
                  edge,
                  participation,
                  previewReady,
                  recoveryReady,
                  Boolean(operation),
                );
                return (
                  <path
                    className={`${edge.signal === "recovery" ? "is-recovery " : ""}${active ? "is-active" : "is-bypassed"}`}
                    d={createPreparationCanvasEdgePath(edge)}
                    data-edge-id={edge.id}
                    key={edge.id}
                  />
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
            progress={null}
            status={operation ? "LOCKED" : "READY"}
            onSelect={selectNode}
          />
          <CanvasNode
            id="scope"
            detail={scopeDetail}
            active
            selected={selectedNode === "scope"}
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
            progress={null}
            status={operation ? "LOCKED" : previewReady ? "VALID" : "UNLOADED"}
            onSelect={selectNode}
          />
          <CanvasNode
            id="commit"
            detail={operation?.currentRelativePath ?? operation?.stageLabel ?? "AWAITING PREVIEW"}
            active={Boolean(operation || content.preview)}
            selected={selectedNode === "commit"}
            progress={operation ? operation.progressPercent : null}
            status={operation?.statusLabel.toUpperCase() ?? (content.preview ? "ARMED" : "LOCKED")}
            onSelect={selectNode}
          />
          <CanvasNode
            id="recovery"
            detail={operation?.id ?? "NO OPERATION RECORD"}
            active={recoveryReady}
            selected={selectedNode === "recovery"}
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
