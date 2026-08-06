import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";

import type { CapabilitySpaceContent } from "../../../../pages/spaces/spacePageModel";
import { usePrefersReducedMotion } from "../../hooks/usePrefersReducedMotion";
import { CapabilityFallbackMap } from "./CapabilityFallbackMap";
import {
  createCapabilityWorldLayout,
  type CapabilityWorldNode,
} from "./model/capabilityWorldLayout";
import type {
  CapabilityWorldRuntime,
  CapabilityWorldViewSnapshot,
} from "./runtime/CapabilityWorldRuntime";

interface CapabilityWorldProps {
  content: CapabilitySpaceContent;
  focusedBranchId: string | null;
  onFocusBranch(branchId: string | null): void;
}

type RenderMode = "initializing" | "webgl" | "fallback";

function minimapPoint(
  value: { x: number; z: number },
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number },
) {
  return {
    x: 8 + ((value.x - bounds.minX) / (bounds.maxX - bounds.minX)) * 144,
    y: 8 + ((bounds.maxZ - value.z) / (bounds.maxZ - bounds.minZ)) * 70,
  };
}

export function CapabilityWorld({ content, focusedBranchId, onFocusBranch }: CapabilityWorldProps) {
  const reducedMotion = usePrefersReducedMotion();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const runtimeRef = useRef<CapabilityWorldRuntime | null>(null);
  const zoomReadoutRef = useRef<HTMLOutputElement>(null);
  const minimapCameraRef = useRef<SVGRectElement>(null);
  const labelElementsRef = useRef(new Map<string, HTMLElement>());
  const [renderMode, setRenderMode] = useState<RenderMode>("initializing");
  const layout = useMemo(() => createCapabilityWorldLayout(content.districts), [content.districts]);
  const objectMap = useMemo(
    () =>
      new Map(
        content.districts.flatMap((district) =>
          district.objects.map((object) => [object.id, object] as const),
        ),
      ),
    [content.districts],
  );
  const actionsRef = useRef({
    selectDistrict: content.selectDistrict,
    selectObject: content.selectObject,
  });
  const focusRef = useRef({
    districtId: content.activeDistrictId,
    objectId: content.activeObjectId,
  });
  actionsRef.current = {
    selectDistrict: content.selectDistrict,
    selectObject: content.selectObject,
  };
  focusRef.current = {
    districtId: content.activeDistrictId,
    objectId: content.activeObjectId,
  };

  const updateViewDom = useCallback(
    (snapshot: CapabilityWorldViewSnapshot) => {
      if (zoomReadoutRef.current) {
        zoomReadoutRef.current.value = `${Math.round(snapshot.zoom * 100)}%`;
      }
      const projected = minimapPoint({ x: snapshot.targetX, z: snapshot.targetZ }, layout.bounds);
      minimapCameraRef.current?.setAttribute("x", `${projected.x - 14}`);
      minimapCameraRef.current?.setAttribute("y", `${projected.y - 8}`);
    },
    [layout.bounds],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || typeof window.WebGLRenderingContext === "undefined") {
      setRenderMode("fallback");
      return;
    }
    let cancelled = false;
    let runtime: CapabilityWorldRuntime | null = null;
    void import("./runtime/CapabilityWorldRuntime")
      .then(({ CapabilityWorldRuntime: WorldRuntime }) => {
        if (cancelled) return;
        runtime = new WorldRuntime(canvas, layout, {
          reducedMotion,
          onPick: (node) => {
            if (node.objectId) {
              const object = objectMap.get(node.objectId);
              if (object) actionsRef.current.selectObject(object);
              return;
            }
            if (node.level === "branch" && node.branchId) {
              onFocusBranch(node.branchId);
              runtimeRef.current?.focusBranch(node.districtId, node.branchId);
              return;
            }
            onFocusBranch(null);
            actionsRef.current.selectDistrict(node.districtId);
          },
          onViewChange: updateViewDom,
        });
        runtimeRef.current = runtime;
        runtime.setFocus(focusRef.current.districtId, focusRef.current.objectId);
        labelElementsRef.current.forEach((element, id) => runtime?.registerLabel(id, element));
        setRenderMode("webgl");
      })
      .catch((reason: unknown) => {
        if (cancelled) return;
        console.warn("Capability world WebGL initialization failed; using SVG topology.", reason);
        setRenderMode("fallback");
      });
    return () => {
      cancelled = true;
      runtime?.dispose();
      if (runtimeRef.current === runtime) runtimeRef.current = null;
    };
  }, [layout, objectMap, onFocusBranch, reducedMotion, updateViewDom]);

  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    if (content.activeObjectId) {
      runtime.setFocus(content.activeDistrictId, content.activeObjectId);
    } else if (content.activeDistrictId && focusedBranchId) {
      runtime.focusBranch(content.activeDistrictId, focusedBranchId);
    } else {
      runtime.setFocus(content.activeDistrictId, null);
    }
  }, [content.activeDistrictId, content.activeObjectId, focusedBranchId, renderMode]);

  const registerLabel = (id: string, element: HTMLElement | null) => {
    if (element) labelElementsRef.current.set(id, element);
    else labelElementsRef.current.delete(id);
    runtimeRef.current?.registerLabel(id, element);
  };

  const activateNode = (node: CapabilityWorldNode) => {
    if (node.objectId) {
      const object = objectMap.get(node.objectId);
      if (object) content.selectObject(object);
      return;
    }
    if (node.level === "branch" && node.branchId) {
      onFocusBranch(node.branchId);
      runtimeRef.current?.focusBranch(node.districtId, node.branchId);
      return;
    }
    onFocusBranch(null);
    content.selectDistrict(node.districtId);
  };

  const selectedNode = layout.nodes.find(
    (candidate) => candidate.objectId === content.activeObjectId,
  );
  const resolvedBranchId = selectedNode?.branchId ?? focusedBranchId;
  const visibleLabels = layout.nodes.filter((node) => {
    if (node.level === "district") return true;
    if (!content.activeDistrictId || node.districtId !== content.activeDistrictId) return false;
    if (node.level === "branch") return true;
    return Boolean(resolvedBranchId && node.branchId === resolvedBranchId);
  });
  const visibleNodeIds = new Set(visibleLabels.map((node) => node.id));
  const worldMode = content.activeObject
    ? "object"
    : focusedBranchId
      ? "branch"
      : content.activeDistrictId
        ? "district"
        : "overview";

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    const step = event.shiftKey ? 230 : 110;
    if (event.key === "ArrowLeft") runtime.panBy(-step, 0);
    else if (event.key === "ArrowRight") runtime.panBy(step, 0);
    else if (event.key === "ArrowUp") runtime.panBy(0, -step * 0.7);
    else if (event.key === "ArrowDown") runtime.panBy(0, step * 0.7);
    else if (event.key === "+" || event.key === "=") runtime.zoomBy(1);
    else if (event.key === "-") runtime.zoomBy(-1);
    else if (event.key === "0") {
      content.returnOverview();
      onFocusBranch(null);
      runtime.fitOverview();
    } else if (event.key === "Escape") {
      if (content.activeObject) content.closeObject();
      else if (focusedBranchId && content.activeDistrictId) {
        onFocusBranch(null);
        runtime.setFocus(content.activeDistrictId, null);
      } else if (content.activeDistrictId) content.returnOverview();
      else return;
    } else return;
    event.preventDefault();
  };

  return (
    <div
      className="dial-archive-capability-world"
      data-world-mode={worldMode}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      aria-label="能力库三维拓扑场；可自由拖动平面，滚轮调整纵深，方向键移动"
    >
      <canvas
        ref={canvasRef}
        className="dial-archive-capability-world__canvas"
        data-render-mode={renderMode}
        aria-hidden="true"
      />

      {renderMode === "fallback" ? (
        <CapabilityFallbackMap
          layout={layout}
          activeDistrictId={content.activeDistrictId}
          activeObjectId={content.activeObjectId}
          focusedBranchId={focusedBranchId}
          onSelectDistrict={content.selectDistrict}
          onSelectObject={(objectId) => {
            const object = objectMap.get(objectId);
            if (object) content.selectObject(object);
          }}
          objects={objectMap}
        />
      ) : null}

      {renderMode !== "fallback" ? (
        <div className="dial-archive-capability-world__labels" aria-label="能力拓扑节点">
          {visibleLabels.map((node) => {
            const sameDistrict = node.districtId === content.activeDistrictId;
            const active =
              (worldMode === "district" && node.level === "district" && sameDistrict) ||
              (worldMode === "branch" &&
                node.level === "branch" &&
                node.branchId === resolvedBranchId) ||
              (worldMode === "object" && node.objectId === content.activeObjectId);
            const parent = Boolean(
              sameDistrict &&
              ((worldMode === "branch" && node.level === "district") ||
                (worldMode === "object" &&
                  node.level === "branch" &&
                  node.branchId === resolvedBranchId)),
            );
            const origin = Boolean(
              sameDistrict && worldMode === "object" && node.level === "district",
            );
            const context = Boolean(
              content.activeDistrictId &&
              ((node.level === "district" && node.districtId !== content.activeDistrictId) ||
                (node.level === "branch" &&
                  resolvedBranchId &&
                  node.branchId !== resolvedBranchId)),
            );
            return (
              <button
                className={`dial-archive-capability-label is-${node.level}${active ? " is-active" : ""}${parent ? " is-parent" : ""}${origin ? " is-origin" : ""}${context ? " is-context" : ""}`}
                type="button"
                ref={(element) => registerLabel(node.id, element)}
                data-projected="false"
                data-role={
                  active
                    ? "focus"
                    : parent
                      ? "parent"
                      : origin
                        ? "origin"
                        : context
                          ? "context"
                          : node.level === "branch"
                            ? "entry"
                            : node.level === "object"
                              ? "resource"
                              : "district"
                }
                data-tone={node.status}
                aria-pressed={active}
                onClick={() => activateNode(node)}
                key={node.id}
              >
                <span className="dial-archive-capability-label__back" aria-hidden="true" />
                <span className="dial-archive-capability-label__surface">
                  <span className="dial-archive-capability-label__head">
                    <em>
                      {node.level === "district"
                        ? `DISTRICT ${node.districtId.slice(0, 3).toUpperCase()}`
                        : node.englishName}
                    </em>
                    <i aria-hidden="true" />
                  </span>
                  <strong>{node.code}</strong>
                  <b>{node.name}</b>
                  <small>{node.summary}</small>
                  <span className="dial-archive-capability-label__reading">{node.reading}</span>
                </span>
              </button>
            );
          })}
          {layout.evidencePlanes
            .filter(
              (evidence) =>
                !content.activeDistrictId ||
                (!focusedBranchId &&
                  !content.activeObjectId &&
                  evidence.districtId === content.activeDistrictId),
            )
            .map((evidence) => (
              <div
                className="dial-archive-capability-evidence-label"
                ref={(element) => registerLabel(evidence.id, element)}
                data-projected="false"
                aria-hidden="true"
                key={evidence.id}
              >
                <span>{evidence.code}</span>
                <strong>{evidence.title}</strong>
                <small>{evidence.rows.join("  /  ")}</small>
              </div>
            ))}
        </div>
      ) : null}

      <header className="dial-archive-capability-world__identity" data-dial-archive-entry>
        <span>06 / SHARED CAPABILITY INFRASTRUCTURE</span>
        <h1>CAPABILITY</h1>
        <p>
          能力库 <i /> PERSISTENT TOPOLOGY WORLD
        </p>
      </header>

      <nav className="dial-archive-capability-districts" aria-label="能力分区">
        {content.districts.map((district) => (
          <button
            type="button"
            className={district.id === content.activeDistrictId ? "is-active" : undefined}
            aria-current={district.id === content.activeDistrictId ? "page" : undefined}
            aria-label={`进入能力分区 ${district.index} ${district.code} ${district.name}`}
            onClick={() => {
              onFocusBranch(null);
              content.selectDistrict(district.id);
              runtimeRef.current?.setFocus(district.id, null);
            }}
            key={district.id}
          >
            <span>{district.index}</span>
            <strong>{district.code}</strong>
            <small>{district.name}</small>
            <em>{district.inventoryValue}</em>
          </button>
        ))}
      </nav>

      <nav className="dial-archive-capability-world__path" aria-label="能力层级路径">
        {(content.activeDistrictId || focusedBranchId || content.activeObject) && (
          <button
            className="dial-archive-capability-world__back"
            type="button"
            onClick={() => {
              const runtime = runtimeRef.current;
              if (content.activeObject) content.closeObject();
              else if (focusedBranchId && content.activeDistrictId) {
                onFocusBranch(null);
                runtime?.setFocus(content.activeDistrictId, null);
              } else {
                onFocusBranch(null);
                content.returnOverview();
                runtime?.fitOverview();
              }
            }}
          >
            <span aria-hidden="true">←</span> BACK
          </button>
        )}
        <button
          type="button"
          onClick={() => {
            onFocusBranch(null);
            content.returnOverview();
            runtimeRef.current?.fitOverview();
          }}
        >
          CAP
        </button>
        {content.activeDistrictId ? (
          <button
            type="button"
            onClick={() => {
              onFocusBranch(null);
              content.selectDistrict(
                content.activeDistrictId as NonNullable<typeof content.activeDistrictId>,
              );
              runtimeRef.current?.setFocus(content.activeDistrictId, null);
            }}
          >
            {content.activeDistrictId.toUpperCase()}
          </button>
        ) : null}
        {resolvedBranchId ? (
          <button
            type="button"
            onClick={() => {
              if (content.activeObject) content.closeObject();
              onFocusBranch(resolvedBranchId);
              if (content.activeDistrictId) {
                runtimeRef.current?.focusBranch(content.activeDistrictId, resolvedBranchId);
              }
            }}
          >
            {resolvedBranchId.toUpperCase()}
          </button>
        ) : null}
        {content.activeObject ? <b>{content.activeObject.code}</b> : null}
      </nav>

      <div className="dial-archive-capability-world__controls" aria-label="世界视图控制">
        <button type="button" onClick={() => runtimeRef.current?.zoomBy(-1)} aria-label="缩小视图">
          −
        </button>
        <output ref={zoomReadoutRef}>100%</output>
        <button type="button" onClick={() => runtimeRef.current?.zoomBy(1)} aria-label="放大视图">
          +
        </button>
        <button
          type="button"
          onClick={() => {
            onFocusBranch(null);
            content.returnOverview();
            runtimeRef.current?.fitOverview();
          }}
        >
          FIT TO WORLD
        </button>
      </div>

      <div className="dial-archive-capability-world__hint" aria-hidden="true">
        DRAG FREE PLANE TO PAN&nbsp;&nbsp; WHEEL THROUGH DEPTH&nbsp;&nbsp; 0 / FIT TO WORLD
      </div>

      <div className="dial-archive-capability-minimap" aria-label="XZ 世界索引">
        <header>
          <span>XZ / FIELD</span>
          <b>{content.activeDistrictId?.slice(0, 3).toUpperCase() ?? "ALL"}</b>
        </header>
        <svg viewBox="0 0 160 86" aria-hidden="true">
          <path d="M 8 16 H 152 M 8 43 H 152 M 8 70 H 152" />
          {layout.nodes
            .filter((node) => visibleNodeIds.has(node.id))
            .map((node) => {
              const projected = minimapPoint(node.position, layout.bounds);
              return (
                <rect
                  className={node.objectId === content.activeObjectId ? "is-active" : undefined}
                  x={projected.x - (node.level === "district" ? 3 : 1.6)}
                  y={projected.y - (node.level === "district" ? 2.5 : 1.4)}
                  width={node.level === "district" ? 6 : 3.2}
                  height={node.level === "district" ? 5 : 2.8}
                  key={node.id}
                />
              );
            })}
          <rect ref={minimapCameraRef} className="is-camera" x="66" y="35" width="28" height="16" />
        </svg>
      </div>

      {content.status !== "ready" ? (
        <div className="dial-archive-capability-world__status" data-status={content.status}>
          <span>
            {content.status === "loading" ? "INDEXING CAPABILITY FIELD" : "PARTIAL FIELD AVAILABLE"}
          </span>
          {content.message ? <p>{content.message}</p> : null}
          {content.status !== "loading" ? (
            <button type="button" onClick={content.refresh}>
              RETRY INDEX
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
