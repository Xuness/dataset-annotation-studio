import type {
  CapabilityDistrictId,
  CapabilityObjectRecord,
} from "../../../../pages/spaces/spacePageModel";
import type { CapabilityWorldLayout, CapabilityWorldNode } from "./model/capabilityWorldLayout";

interface CapabilityFallbackMapProps {
  layout: CapabilityWorldLayout;
  activeDistrictId: CapabilityDistrictId | null;
  activeObjectId: string | null;
  focusedBranchId?: string | null;
  onSelectDistrict(districtId: CapabilityDistrictId): void;
  onSelectObject(objectId: string): void;
  objects: ReadonlyMap<string, CapabilityObjectRecord>;
}

function point(layout: CapabilityWorldLayout, node: CapabilityWorldNode) {
  const width = layout.bounds.maxX - layout.bounds.minX;
  const depth = layout.bounds.maxZ - layout.bounds.minZ;
  return {
    x: 70 + ((node.position.x - layout.bounds.minX) / width) * 2060,
    y: 100 + ((layout.bounds.maxZ - node.position.z) / depth) * 940,
  };
}

export function CapabilityFallbackMap({
  layout,
  activeDistrictId,
  activeObjectId,
  focusedBranchId,
  onSelectDistrict,
  onSelectObject,
  objects,
}: CapabilityFallbackMapProps) {
  const selectedBranchId =
    layout.nodes.find((node) => node.objectId === activeObjectId)?.branchId ?? focusedBranchId;
  const visibleNodes = layout.nodes.filter((node) => {
    if (node.level === "district") return true;
    if (!activeDistrictId || node.districtId !== activeDistrictId) return false;
    if (node.level === "branch") return true;
    return Boolean(selectedBranchId && node.branchId === selectedBranchId);
  });
  return (
    <div className="dial-archive-capability-fallback" role="img" aria-label="能力库轻量拓扑图">
      <svg viewBox="0 0 2200 1120" aria-hidden="true">
        <g className="dial-archive-capability-fallback__grid">
          {Array.from({ length: 10 }, (_, index) => (
            <line x1={index * 244} y1="0" x2={index * 244} y2="1120" key={`v-${index}`} />
          ))}
          {Array.from({ length: 6 }, (_, index) => (
            <line x1="0" y1={index * 224} x2="2200" y2={index * 224} key={`h-${index}`} />
          ))}
        </g>
        <g className="dial-archive-capability-fallback__edges">
          {layout.edges
            .filter(
              (edge) =>
                Boolean(activeDistrictId) &&
                edge.districtId === activeDistrictId &&
                (edge.kind === "trunk" ||
                  (edge.kind === "spine" && !edge.branchId) ||
                  (selectedBranchId && edge.branchId === selectedBranchId)),
            )
            .map((edge) => {
              const points = edge.points
                .map((candidate) => {
                  const width = layout.bounds.maxX - layout.bounds.minX;
                  const depth = layout.bounds.maxZ - layout.bounds.minZ;
                  return `${70 + ((candidate.x - layout.bounds.minX) / width) * 2060},${100 + ((layout.bounds.maxZ - candidate.z) / depth) * 940}`;
                })
                .join(" ");
              const active = Boolean(
                (activeObjectId && edge.objectId === activeObjectId) ||
                (selectedBranchId && edge.branchId === selectedBranchId),
              );
              return (
                <polyline
                  points={points}
                  className={active ? "is-active" : undefined}
                  data-dashed={edge.dashed ? "true" : undefined}
                  key={edge.id}
                />
              );
            })}
        </g>
        <g className="dial-archive-capability-fallback__nodes">
          {visibleNodes.map((node) => {
            const projected = point(layout, node);
            const active = node.objectId
              ? node.objectId === activeObjectId
              : node.districtId === activeDistrictId;
            return (
              <g
                className={`is-${node.level}${active ? " is-active" : ""}`}
                transform={`translate(${projected.x} ${projected.y})`}
                key={node.id}
              >
                <rect
                  x={node.level === "district" ? -92 : -58}
                  y="-25"
                  width={node.level === "district" ? 184 : 116}
                  height="50"
                />
                <text y="5" textAnchor="middle">
                  {node.code}
                </text>
              </g>
            );
          })}
        </g>
      </svg>
      <div className="dial-archive-capability-fallback__actions">
        {visibleNodes.map((node) => (
          <button
            type="button"
            key={node.id}
            onClick={() => {
              if (node.objectId && objects.has(node.objectId)) onSelectObject(node.objectId);
              else onSelectDistrict(node.districtId);
            }}
          >
            <span>{node.code}</span>
            <strong>{node.name}</strong>
          </button>
        ))}
      </div>
      <p>LIGHTWEIGHT TOPOLOGY // WEBGL UNAVAILABLE</p>
    </div>
  );
}
