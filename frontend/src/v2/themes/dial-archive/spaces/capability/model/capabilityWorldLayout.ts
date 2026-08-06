import type {
  CapabilityDistrictId,
  CapabilityDistrictRecord,
  CapabilityObjectKind,
  CapabilitySignalTone,
} from "../../../../../pages/spaces/spacePageModel";

export interface CapabilityWorldPoint {
  x: number;
  y: number;
  z: number;
}

export interface CapabilityWorldSize {
  x: number;
  y: number;
  z: number;
}

export type CapabilityWorldGeometry =
  | "district-plate"
  | "branch-gate"
  | "provider-beam"
  | "runtime-rig"
  | "tagger-upright"
  | "profile-tray"
  | "dictionary-card"
  | "override-deck"
  | "prompt-document";

export interface CapabilityWorldNode {
  id: string;
  districtId: CapabilityDistrictId;
  branchId: string | null;
  objectId: string | null;
  objectKind: CapabilityObjectKind | null;
  level: "district" | "branch" | "object";
  geometry: CapabilityWorldGeometry;
  position: CapabilityWorldPoint;
  size: CapabilityWorldSize;
  rotation: CapabilityWorldPoint;
  labelAnchor: CapabilityWorldPoint;
  code: string;
  name: string;
  englishName: string;
  summary: string;
  status: CapabilitySignalTone;
  reading: string;
}

export interface CapabilityWorldEdge {
  id: string;
  districtId: CapabilityDistrictId;
  branchId: string | null;
  objectId: string | null;
  kind: "spine" | "trunk" | "branch" | "relation";
  dashed: boolean;
  points: readonly CapabilityWorldPoint[];
}

export interface CapabilityEvidencePlane {
  id: string;
  districtId: CapabilityDistrictId;
  code: string;
  title: string;
  position: CapabilityWorldPoint;
  size: { width: number; height: number };
  rotation: CapabilityWorldPoint;
  rows: readonly string[];
}

export interface CapabilityCameraPose {
  position: CapabilityWorldPoint;
  target: CapabilityWorldPoint;
  fov?: number;
}

export interface CapabilityWorldLayout {
  nodes: readonly CapabilityWorldNode[];
  edges: readonly CapabilityWorldEdge[];
  evidencePlanes: readonly CapabilityEvidencePlane[];
  districtOrigins: Readonly<Record<CapabilityDistrictId, CapabilityWorldPoint>>;
  overviewPose: CapabilityCameraPose;
  districtPoses: Readonly<Record<CapabilityDistrictId, CapabilityCameraPose>>;
  branchPoses: Readonly<Record<string, CapabilityCameraPose>>;
  objectPoses: Readonly<Record<string, CapabilityCameraPose>>;
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
}

const DISTRICT_ORIGINS: Readonly<Record<CapabilityDistrictId, CapabilityWorldPoint>> = {
  providers: { x: -10_500, y: 0, z: 800 },
  taggers: { x: -3500, y: 0, z: -200 },
  dictionaries: { x: 3500, y: 0, z: 700 },
  prompts: { x: 10_500, y: 0, z: -100 },
};

const PROVIDER_BRANCH_POSITIONS: readonly CapabilityWorldPoint[] = [
  { x: -2300, y: 300, z: -3800 },
  { x: 2300, y: 760, z: -6800 },
  { x: -2300, y: 320, z: -9800 },
  { x: 2300, y: 820, z: -12_800 },
  { x: 0, y: 380, z: -15_800 },
];

const TAGGER_BRANCH_POSITIONS: readonly CapabilityWorldPoint[] = [
  { x: -2300, y: 300, z: -4200 },
  { x: 2300, y: 820, z: -7800 },
  { x: 0, y: 340, z: -11_400 },
];

const DICTIONARY_BRANCH_POSITIONS: readonly CapabilityWorldPoint[] = [
  { x: -2200, y: 300, z: -4600 },
  { x: 2200, y: 820, z: -9000 },
];

const PROMPT_BRANCH_POSITIONS: readonly CapabilityWorldPoint[] = [
  { x: -2200, y: 820, z: -4600 },
  { x: 2200, y: 300, z: -9000 },
];

const GENERAL_CHILD_POSITIONS: readonly CapabilityWorldPoint[] = [
  { x: 1200, y: 300, z: -4200 },
  { x: -3200, y: 1250, z: -8200 },
  { x: 3200, y: 260, z: -12_200 },
  { x: -3200, y: 1350, z: -16_200 },
  { x: 3200, y: 300, z: -20_200 },
  { x: -3200, y: 1250, z: -24_200 },
  { x: 3200, y: 420, z: -28_200 },
];

const TAGGER_CHILD_POSITIONS: readonly CapabilityWorldPoint[] = [
  { x: 1200, y: 320, z: -4200 },
  { x: -3300, y: 1280, z: -8200 },
  { x: 3300, y: 280, z: -12_200 },
  { x: -3300, y: 1380, z: -16_200 },
  { x: 3300, y: 320, z: -20_200 },
  { x: -3300, y: 1280, z: -24_200 },
  { x: 3300, y: 440, z: -28_200 },
];

const DICTIONARY_CHILD_POSITIONS: readonly CapabilityWorldPoint[] = [
  { x: 1200, y: 320, z: -4200 },
  { x: -3100, y: 1250, z: -8400 },
  { x: 3100, y: 300, z: -12_600 },
  { x: -3100, y: 1350, z: -16_800 },
];

const PROMPT_CHILD_POSITIONS: readonly CapabilityWorldPoint[] = [
  { x: 1200, y: 1180, z: -4200 },
  { x: -3100, y: 300, z: -8400 },
  { x: 3100, y: 1260, z: -12_600 },
  { x: -3100, y: 360, z: -16_800 },
  { x: 3100, y: 1320, z: -21_000 },
];

function add(left: CapabilityWorldPoint, right: CapabilityWorldPoint): CapabilityWorldPoint {
  return { x: left.x + right.x, y: left.y + right.y, z: left.z + right.z };
}

function districtNode(district: CapabilityDistrictRecord): CapabilityWorldNode {
  const origin = DISTRICT_ORIGINS[district.id];
  const size = { x: 650, y: 16, z: 370 };
  return {
    id: `district:${district.id}`,
    districtId: district.id,
    branchId: null,
    objectId: null,
    objectKind: null,
    level: "district",
    geometry: "district-plate",
    position: origin,
    size,
    rotation: {
      x: 0,
      y: district.id === "taggers" ? -0.025 : district.id === "dictionaries" ? 0.025 : 0,
      z: 0,
    },
    labelAnchor: add(origin, { x: 0, y: size.y / 2 + 2, z: 0 }),
    code: district.code,
    name: district.name,
    englishName: district.englishName,
    summary: district.summary,
    status: district.status,
    reading: `${district.inventoryLabel}  ${district.inventoryValue}`,
  };
}

interface DistrictDraft {
  nodes: CapabilityWorldNode[];
  edges: CapabilityWorldEdge[];
}

function makeBranchNode(
  district: CapabilityDistrictRecord,
  branchIndex: number,
  localPosition: CapabilityWorldPoint,
): CapabilityWorldNode {
  const branch = district.branches[branchIndex];
  const origin = DISTRICT_ORIGINS[district.id];
  const position = add(origin, localPosition);
  const size = { x: 430, y: 13, z: 238 };
  return {
    id: `branch:${district.id}:${branch.id}`,
    districtId: district.id,
    branchId: branch.id,
    objectId: null,
    objectKind: null,
    level: "branch",
    geometry: "branch-gate",
    position,
    size,
    rotation: { x: 0, y: branchIndex % 2 === 0 ? -0.018 : 0.018, z: 0 },
    labelAnchor: add(position, { x: 0, y: size.y / 2 + 2, z: 0 }),
    code: branch.code,
    name: branch.name,
    englishName: branch.englishName,
    summary: branch.summary,
    status: branch.status,
    reading: `${String(branch.count).padStart(2, "0")} OBJECTS`,
  };
}

function objectNode(
  district: CapabilityDistrictRecord,
  objectId: string,
  geometry: CapabilityWorldGeometry,
  position: CapabilityWorldPoint,
  size: CapabilityWorldSize,
  rotationY = 0,
): CapabilityWorldNode {
  const object = district.objects.find((candidate) => candidate.id === objectId);
  if (!object) throw new Error(`Capability object is missing from ${district.id}: ${objectId}`);
  return {
    id: `object:${object.id}`,
    districtId: district.id,
    branchId: object.branchId,
    objectId: object.id,
    objectKind: object.kind,
    level: "object",
    geometry,
    position,
    size,
    rotation: { x: 0, y: rotationY, z: 0 },
    labelAnchor: add(position, { x: 0, y: size.y / 2 + 2, z: 0 }),
    code: object.code,
    name: object.name,
    englishName: object.englishName,
    summary: object.summary,
    status: object.status,
    reading: object.readings
      .slice(0, 2)
      .map((reading) => `${reading.label.toUpperCase()} ${reading.value}`)
      .join(" / "),
  };
}

function railHeight(node: CapabilityWorldNode): number {
  return node.position.y + node.size.y / 2 + 26;
}

function spineEdge(
  parent: CapabilityWorldNode,
  children: readonly CapabilityWorldNode[],
): CapabilityWorldEdge {
  const y = railHeight(parent);
  const stationDepths = [...new Set(children.map((child) => child.position.z))].sort(
    (left, right) => right - left,
  );
  const firstZ = parent.position.z - parent.size.z / 2;
  const lastZ = (stationDepths.at(-1) ?? firstZ - 2600) - 1800;
  return {
    id: `edge:spine:${parent.id}`,
    districtId: parent.districtId,
    branchId: parent.level === "branch" ? parent.branchId : null,
    objectId: null,
    kind: "spine",
    dashed: false,
    points: [
      { x: parent.position.x, y, z: firstZ },
      ...stationDepths.map((z) => ({ x: parent.position.x, y, z })),
      { x: parent.position.x, y, z: lastZ },
    ],
  };
}

function stationEdge(
  parent: CapabilityWorldNode,
  child: CapabilityWorldNode,
  kind: "trunk" | "branch",
  dashed: boolean,
): CapabilityWorldEdge {
  const y = railHeight(parent);
  const station = { x: parent.position.x, y, z: child.position.z };
  const end = {
    x: child.position.x,
    y: railHeight(child),
    z: child.position.z + child.size.z / 2,
  };
  return {
    id: `edge:${parent.id}:${child.id}`,
    districtId: child.districtId,
    branchId: child.branchId,
    objectId: child.objectId,
    kind,
    dashed,
    points: [station, { x: end.x, y, z: station.z }, end],
  };
}

function branchPositions(districtId: CapabilityDistrictId): readonly CapabilityWorldPoint[] {
  if (districtId === "providers") return PROVIDER_BRANCH_POSITIONS;
  if (districtId === "taggers") return TAGGER_BRANCH_POSITIONS;
  if (districtId === "dictionaries") return DICTIONARY_BRANCH_POSITIONS;
  return PROMPT_BRANCH_POSITIONS;
}

function childPositions(districtId: CapabilityDistrictId): readonly CapabilityWorldPoint[] {
  if (districtId === "taggers") return TAGGER_CHILD_POSITIONS;
  if (districtId === "dictionaries") return DICTIONARY_CHILD_POSITIONS;
  if (districtId === "prompts") return PROMPT_CHILD_POSITIONS;
  return GENERAL_CHILD_POSITIONS;
}

function objectGeometry(objectKind: CapabilityObjectKind): CapabilityWorldGeometry {
  if (objectKind === "provider") return "provider-beam";
  if (objectKind === "tagger-runtime") return "runtime-rig";
  if (objectKind === "tagger-installation") return "tagger-upright";
  if (objectKind === "tagger-profile") return "profile-tray";
  if (objectKind === "dictionary") return "dictionary-card";
  if (objectKind === "dictionary-overrides") return "override-deck";
  return "prompt-document";
}

function objectSize(geometry: CapabilityWorldGeometry): CapabilityWorldSize {
  if (geometry === "provider-beam") return { x: 470, y: 14, z: 250 };
  if (geometry === "tagger-upright") return { x: 430, y: 14, z: 250 };
  if (geometry === "runtime-rig") return { x: 460, y: 14, z: 260 };
  if (geometry === "profile-tray") return { x: 440, y: 13, z: 250 };
  if (geometry === "dictionary-card") return { x: 430, y: 12, z: 245 };
  if (geometry === "override-deck") return { x: 470, y: 14, z: 270 };
  return { x: 430, y: 12, z: 260 };
}

function createDistrictDraft(district: CapabilityDistrictRecord): DistrictDraft {
  const nodes: CapabilityWorldNode[] = [];
  const edges: CapabilityWorldEdge[] = [];
  const root = districtNode(district);
  const branches = branchPositions(district.id);
  const children = childPositions(district.id);

  const branchNodes = district.branches.map((_branch, branchIndex) =>
    makeBranchNode(
      district,
      branchIndex,
      branches[branchIndex] ?? {
        x: branchIndex === district.branches.length - 1 ? 0 : branchIndex % 2 ? 2200 : -2200,
        y: branchIndex % 2 === 0 ? 240 : 820,
        z: -4200 - branchIndex * 3400,
      },
    ),
  );
  nodes.push(...branchNodes);
  edges.push(spineEdge(root, branchNodes));
  branchNodes.forEach((branchNode, branchIndex) => {
    edges.push(stationEdge(root, branchNode, "trunk", branchIndex > 1));
  });

  district.branches.forEach((branch, branchIndex) => {
    const branchNode = branchNodes[branchIndex];
    if (!branchNode) return;
    const objectNodes: CapabilityWorldNode[] = [];
    branch.objectIds.forEach((id, objectIndex) => {
      const object = district.objects.find((candidate) => candidate.id === id);
      if (!object) return;
      const local = children[objectIndex] ?? {
        x: objectIndex === 0 ? 0 : objectIndex % 2 === 0 ? 2200 : -2200,
        y: objectIndex % 2 === 0 ? 320 : 820,
        z: -4200 - objectIndex * 3600,
      };
      const geometry = objectGeometry(object.kind);
      const node = objectNode(
        district,
        id,
        geometry,
        add(branchNode.position, local),
        objectSize(geometry),
        ((objectIndex % 3) - 1) * 0.018,
      );
      nodes.push(node);
      objectNodes.push(node);
    });
    if (!objectNodes.length) return;
    edges.push(spineEdge(branchNode, objectNodes));
    objectNodes.forEach((node, objectIndex) => {
      edges.push(stationEdge(branchNode, node, "branch", objectIndex > 2));
    });
  });

  return { nodes, edges };
}

function evidencePlanes(): readonly CapabilityEvidencePlane[] {
  return [
    {
      id: "evidence:providers",
      districtId: "providers",
      code: "PROTOCOL / REQUEST MATRIX",
      title: "MODEL GATEWAY",
      position: add(DISTRICT_ORIGINS.providers, { x: 0, y: 650, z: -7600 }),
      size: { width: 2100, height: 980 },
      rotation: { x: -0.05, y: 0.08, z: 0 },
      rows: ["AUTH  01", "MODEL  12", "STREAM  READY", "RETRY  BOUNDED"],
    },
    {
      id: "evidence:taggers",
      districtId: "taggers",
      code: "DEVICE / CATEGORY FIELD",
      title: "LOCAL INFERENCE",
      position: add(DISTRICT_ORIGINS.taggers, { x: 0, y: 620, z: -7600 }),
      size: { width: 2200, height: 1040 },
      rotation: { x: 0.02, y: -0.06, z: 0 },
      rows: ["CUDA  DEVICE", "GENERAL  CHARACTER", "THRESHOLD  0.55", "PROFILE  REUSE"],
    },
    {
      id: "evidence:dictionaries",
      districtId: "dictionaries",
      code: "ENTRY / LICENSE TRACE",
      title: "DICTIONARY STACK",
      position: add(DISTRICT_ORIGINS.dictionaries, { x: 0, y: 680, z: -7800 }),
      size: { width: 2050, height: 980 },
      rotation: { x: -0.03, y: 0.05, z: 0 },
      rows: ["TAG", "CATEGORY", "TRANSLATION", "SOURCE / LICENSE"],
    },
    {
      id: "evidence:prompts",
      districtId: "prompts",
      code: "PROMPT / REVISION TRACE",
      title: "PROTOCOL ARCHIVE",
      position: add(DISTRICT_ORIGINS.prompts, { x: 0, y: 720, z: -8000 }),
      size: { width: 2180, height: 1040 },
      rotation: { x: 0.04, y: -0.08, z: 0 },
      rows: ["SYSTEM", "CONTEXT", "TRANSLATION", "VERSION / SNAPSHOT"],
    },
  ];
}

function stagePose(
  nodes: readonly CapabilityWorldNode[],
  minimumDistance: number,
): CapabilityCameraPose {
  const minX = Math.min(...nodes.map((node) => node.position.x - node.size.x / 2));
  const maxX = Math.max(...nodes.map((node) => node.position.x + node.size.x / 2));
  const minZ = Math.min(...nodes.map((node) => node.position.z - node.size.z / 2));
  const maxZ = Math.max(...nodes.map((node) => node.position.z + node.size.z / 2));
  const width = maxX - minX;
  const depth = maxZ - minZ;
  const distance = Math.max(minimumDistance, width * 1.08, depth * 0.92);
  const centerX = (minX + maxX) / 2;
  const centerZ = (minZ + maxZ) / 2;
  return {
    position: { x: centerX - width * 0.025, y: distance * 0.34, z: centerZ + distance },
    target: { x: centerX, y: 0, z: centerZ },
  };
}

function districtPose(origin: CapabilityWorldPoint): CapabilityCameraPose {
  const target = add(origin, { x: 0, y: -400, z: -7000 });
  return {
    position: add(target, { x: 2600, y: 1550, z: 11_800 }),
    target,
    fov: 31,
  };
}

function branchPose(branch: CapabilityWorldNode): CapabilityCameraPose {
  const target = add(branch.position, { x: 0, y: 0, z: -6500 });
  return {
    position: add(target, { x: 2200, y: 1250, z: 10_500 }),
    target,
    fov: 32,
  };
}

function objectPose(node: CapabilityWorldNode): CapabilityCameraPose {
  const target = add(node.position, { x: 1400, y: -180, z: -1300 });
  return {
    position: add(target, { x: 2500, y: 1000, z: 7600 }),
    target,
    fov: 32,
  };
}

export function createCapabilityWorldLayout(
  districts: readonly CapabilityDistrictRecord[],
): CapabilityWorldLayout {
  const districtNodes = districts.map(districtNode);
  const nodes = [...districtNodes];
  const edges: CapabilityWorldEdge[] = [];
  for (const district of districts) {
    const draft = createDistrictDraft(district);
    nodes.push(...draft.nodes);
    edges.push(...draft.edges);
  }

  const districtPoses = Object.fromEntries(
    districts.map((district) => [district.id, districtPose(DISTRICT_ORIGINS[district.id])]),
  ) as Record<CapabilityDistrictId, CapabilityCameraPose>;

  const branchPoses = Object.fromEntries(
    nodes
      .filter((node) => node.level === "branch" && node.branchId)
      .map((branch) => [`${branch.districtId}:${branch.branchId}`, branchPose(branch)]),
  );

  const objectPoses = Object.fromEntries(
    nodes
      .filter((node) => node.level === "object" && node.objectId)
      .map((node) => [node.objectId as string, objectPose(node)]),
  );

  const minX = Math.min(...nodes.map((node) => node.position.x - node.size.x / 2));
  const maxX = Math.max(...nodes.map((node) => node.position.x + node.size.x / 2));
  const minZ = Math.min(...nodes.map((node) => node.position.z - node.size.z / 2));
  const maxZ = Math.max(...nodes.map((node) => node.position.z + node.size.z / 2));

  return {
    nodes,
    edges,
    evidencePlanes: evidencePlanes(),
    districtOrigins: DISTRICT_ORIGINS,
    overviewPose: stagePose(districtNodes, 18_000),
    districtPoses,
    branchPoses,
    objectPoses,
    bounds: { minX, maxX, minZ, maxZ },
  };
}

export const CAPABILITY_WORLD_CAMERA = {
  fov: 35,
  near: 10,
  far: 90_000,
  minimumZoom: 0.22,
  maximumZoom: 3.4,
  wheelSensitivity: 0.00108,
  wheelDepthSensitivity: 3.4,
  dragSensitivity: 1.12,
  focusDurationMs: 760,
  objectFocusDurationMs: 420,
  overviewDurationMs: 840,
} as const;
