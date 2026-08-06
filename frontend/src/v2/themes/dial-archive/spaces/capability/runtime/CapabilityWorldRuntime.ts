import * as THREE from "three";

import type { CapabilityDistrictId } from "../../../../../pages/spaces/spacePageModel";
import {
  CAPABILITY_WORLD_CAMERA,
  type CapabilityCameraPose,
  type CapabilityEvidencePlane,
  type CapabilityWorldEdge,
  type CapabilityWorldLayout,
  type CapabilityWorldNode,
  type CapabilityWorldPoint,
} from "../model/capabilityWorldLayout";

export interface CapabilityWorldViewSnapshot {
  targetX: number;
  targetZ: number;
  zoom: number;
}

interface CapabilityWorldRuntimeOptions {
  reducedMotion: boolean;
  onPick(node: CapabilityWorldNode): void;
  onViewChange(snapshot: CapabilityWorldViewSnapshot): void;
}

interface CameraTransition {
  startedAt: number;
  duration: number;
  fromPosition: THREE.Vector3;
  fromTarget: THREE.Vector3;
  fromFov: number;
  toPosition: THREE.Vector3;
  toTarget: THREE.Vector3;
  toFov: number;
}

interface PointerGesture {
  pointerId: number;
  startX: number;
  startY: number;
  previousX: number;
  previousY: number;
  dragged: boolean;
}

const COLOR = {
  paper: 0xffffff,
  field: 0xfafafa,
  soft: 0xf2f2f2,
  rule: 0xd9d9d9,
  muted: 0xa9aaac,
  carbon: 0x191919,
  signal: 0xfffa00,
} as const;

function vector(point: CapabilityWorldPoint): THREE.Vector3 {
  return new THREE.Vector3(point.x, point.y, point.z);
}

function easeOutQuint(value: number): number {
  return 1 - (1 - value) ** 5;
}

function materialList(object: THREE.Object3D): THREE.Material[] {
  const candidate = object as THREE.Mesh | THREE.Line | THREE.Points;
  if (!("material" in candidate)) return [];
  return Array.isArray(candidate.material) ? candidate.material : [candidate.material];
}

function disposeObject(root: THREE.Object3D) {
  root.traverse((object) => {
    const candidate = object as THREE.Mesh | THREE.Line | THREE.Points;
    if ("geometry" in candidate) candidate.geometry.dispose();
    for (const material of materialList(object)) material.dispose();
  });
}

export class CapabilityWorldRuntime {
  private readonly canvas: HTMLCanvasElement;
  private readonly layout: CapabilityWorldLayout;
  private readonly options: CapabilityWorldRuntimeOptions;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(
    CAPABILITY_WORLD_CAMERA.fov,
    1,
    CAPABILITY_WORLD_CAMERA.near,
    CAPABILITY_WORLD_CAMERA.far,
  );
  private readonly target = new THREE.Vector3();
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private readonly dragPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private readonly nodeById = new Map<string, CapabilityWorldNode>();
  private readonly nodeGroups = new Map<string, THREE.Group>();
  private readonly edgeGroups = new Map<string, THREE.Group>();
  private readonly evidenceGroups = new Map<CapabilityDistrictId, THREE.Group>();
  private readonly instrumentGroups = new Map<CapabilityDistrictId, THREE.Group>();
  private readonly pickables: THREE.Object3D[] = [];
  private readonly labelElements = new Map<string, HTMLElement>();
  private readonly projectionAnchors = new Map<string, THREE.Vector3>();
  private readonly resizeObserver: ResizeObserver;
  private activeDistrictId: CapabilityDistrictId | null = null;
  private activeBranchId: string | null = null;
  private activeObjectId: string | null = null;
  private pointerGesture: PointerGesture | null = null;
  private transition: CameraTransition | null = null;
  private animationFrame: number | null = null;
  private zoomLevel = 1;
  private disposed = false;

  constructor(
    canvas: HTMLCanvasElement,
    layout: CapabilityWorldLayout,
    options: CapabilityWorldRuntimeOptions,
  ) {
    this.canvas = canvas;
    this.layout = layout;
    this.options = options;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      powerPreference: "high-performance",
    });
    this.renderer.setClearColor(COLOR.field, 1);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    this.scene.background = new THREE.Color(COLOR.field);
    this.scene.fog = new THREE.Fog(COLOR.field, 18_000, 70_000);
    this.camera.position.copy(vector(layout.overviewPose.position));
    this.target.copy(vector(layout.overviewPose.target));
    this.camera.lookAt(this.target);
    this.buildWorld();
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas);
    this.bindEvents();
    this.resize();
    this.updateFocusAppearance();
    this.requestRender();
  }

  registerLabel(id: string, element: HTMLElement | null) {
    if (element) this.labelElements.set(id, element);
    else this.labelElements.delete(id);
    this.requestRender();
  }

  setFocus(districtId: CapabilityDistrictId | null, objectId: string | null) {
    this.activeDistrictId = districtId;
    this.activeBranchId = null;
    this.activeObjectId = objectId;
    this.updateFocusAppearance();
    const pose = objectId
      ? this.layout.objectPoses[objectId]
      : districtId
        ? this.layout.districtPoses[districtId]
        : this.layout.overviewPose;
    this.animateTo(
      pose,
      objectId
        ? CAPABILITY_WORLD_CAMERA.objectFocusDurationMs
        : districtId
          ? CAPABILITY_WORLD_CAMERA.focusDurationMs
          : CAPABILITY_WORLD_CAMERA.overviewDurationMs,
    );
  }

  focusBranch(districtId: CapabilityDistrictId, branchId: string) {
    const pose = this.layout.branchPoses[`${districtId}:${branchId}`];
    if (!pose) return;
    this.activeDistrictId = districtId;
    this.activeBranchId = branchId;
    this.activeObjectId = null;
    this.updateFocusAppearance();
    this.animateTo(pose, CAPABILITY_WORLD_CAMERA.focusDurationMs);
  }

  fitOverview() {
    this.animateTo(this.layout.overviewPose, CAPABILITY_WORLD_CAMERA.overviewDurationMs);
  }

  zoomBy(direction: number) {
    this.applyZoom(direction * -180);
  }

  panBy(deltaX: number, deltaZ: number) {
    this.transition = null;
    this.camera.position.x += deltaX;
    this.camera.position.z += deltaZ;
    this.target.x += deltaX;
    this.target.z += deltaZ;
    this.camera.lookAt(this.target);
    this.requestRender();
  }

  dispose() {
    this.disposed = true;
    if (this.animationFrame != null) cancelAnimationFrame(this.animationFrame);
    this.animationFrame = null;
    this.resizeObserver.disconnect();
    this.unbindEvents();
    disposeObject(this.scene);
    this.renderer.dispose();
    this.labelElements.clear();
  }

  private buildWorld() {
    const world = new THREE.Group();
    world.name = "capability-world";
    this.scene.add(world);
    this.createDepthDust(world);
    this.createSurveyLines(world);
    for (const evidence of this.layout.evidencePlanes) this.createEvidencePlane(world, evidence);
    for (const edge of this.layout.edges) this.createEdge(world, edge);
    for (const node of this.layout.nodes) this.createNode(world, node);
    for (const districtId of Object.keys(this.layout.districtOrigins) as CapabilityDistrictId[]) {
      this.createInstrument(world, districtId);
    }
  }

  private createBasicMaterial(
    color: number,
    opacity: number,
    options: { depthWrite?: boolean; side?: THREE.Side } = {},
  ) {
    const material = new THREE.MeshBasicMaterial({
      color,
      transparent: opacity < 1,
      opacity,
      depthWrite: options.depthWrite ?? opacity >= 0.92,
      side: options.side ?? THREE.FrontSide,
    });
    material.userData.baseOpacity = opacity;
    return material;
  }

  private createLineMaterial(color: number, opacity: number, dashed = false) {
    const material = dashed
      ? new THREE.LineDashedMaterial({
          color,
          transparent: true,
          opacity,
          dashSize: 34,
          gapSize: 22,
          depthWrite: false,
        })
      : new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthWrite: false });
    material.userData.baseOpacity = opacity;
    return material;
  }

  private createNode(world: THREE.Group, node: CapabilityWorldNode) {
    const group = new THREE.Group();
    group.name = node.id;
    group.position.copy(vector(node.position));
    group.rotation.set(node.rotation.x, node.rotation.y, node.rotation.z);
    group.userData.districtId = node.districtId;
    group.userData.branchId = node.branchId;
    group.userData.objectId = node.objectId;
    group.userData.level = node.level;
    this.nodeById.set(node.id, node);
    this.nodeGroups.set(node.id, group);
    this.projectionAnchors.set(node.id, vector(node.labelAnchor));

    this.createPickProxy(group, node);
    world.add(group);
  }

  private createPickProxy(group: THREE.Group, node: CapabilityWorldNode) {
    const width = node.size.x + 70;
    const height = node.size.y + 90;
    const depth = node.size.z + 70;
    const proxy = new THREE.Mesh(
      new THREE.BoxGeometry(width, height, depth),
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }),
    );
    proxy.userData.nodeId = node.id;
    group.add(proxy);
    this.pickables.push(proxy);
  }

  private createEdge(world: THREE.Group, edge: CapabilityWorldEdge) {
    const group = new THREE.Group();
    group.name = edge.id;
    group.userData.districtId = edge.districtId;
    group.userData.branchId = edge.branchId;
    group.userData.objectId = edge.objectId;
    group.userData.kind = edge.kind;
    const geometry = new THREE.BufferGeometry().setFromPoints(edge.points.map(vector));
    const baseOpacity = edge.kind === "spine" ? 0.62 : edge.kind === "trunk" ? 0.4 : 0.28;
    const line = new THREE.Line(
      geometry,
      this.createLineMaterial(COLOR.carbon, baseOpacity, edge.dashed),
    );
    if (edge.dashed) line.computeLineDistances();
    group.add(line);
    const signalGeometry = geometry.clone();
    const signal = new THREE.Line(
      signalGeometry,
      this.createLineMaterial(COLOR.signal, 0.98, edge.dashed),
    );
    if (edge.dashed) signal.computeLineDistances();
    signal.userData.isSignal = true;
    signal.visible = false;
    group.add(signal);

    if (edge.kind === "spine") {
      const start = edge.points[0];
      const end = edge.points.at(-1) ?? start;
      const rail = new THREE.Mesh(
        new THREE.BoxGeometry(10, 4, Math.max(1, Math.abs(end.z - start.z))),
        this.createBasicMaterial(COLOR.carbon, 0.7, { depthWrite: false }),
      );
      rail.position.set(start.x, start.y, (start.z + end.z) / 2);
      group.add(rail);
      const liveCap = new THREE.Mesh(
        new THREE.BoxGeometry(20, 8, 120),
        this.createBasicMaterial(COLOR.signal, 0.98, { depthWrite: false }),
      );
      liveCap.position.set(start.x, start.y + 3, start.z - 60);
      group.add(liveCap);
    }

    const junctionPoints =
      edge.kind === "spine"
        ? edge.points.slice(1, -1)
        : [edge.points[Math.floor(edge.points.length / 2)]];
    for (const point of junctionPoints) {
      const junctionPoint = vector(point);
      const junction = new THREE.Mesh(
        new THREE.BoxGeometry(edge.kind === "spine" ? 30 : 16, 6, edge.kind === "spine" ? 12 : 16),
        this.createBasicMaterial(COLOR.carbon, 0.82, { depthWrite: false }),
      );
      junction.position.copy(junctionPoint);
      junction.rotation.y = edge.kind === "spine" ? 0 : Math.PI / 4;
      group.add(junction);
      const junctionCore = new THREE.Mesh(
        new THREE.BoxGeometry(6, 8, 6),
        this.createBasicMaterial(COLOR.signal, 0.96, { depthWrite: false }),
      );
      junctionCore.position.copy(junctionPoint);
      junctionCore.position.y += 3;
      junctionCore.rotation.y = Math.PI / 4;
      group.add(junctionCore);
    }

    this.edgeGroups.set(edge.id, group);
    world.add(group);
  }

  private createEvidencePlane(world: THREE.Group, evidence: CapabilityEvidencePlane) {
    const group = new THREE.Group();
    group.name = evidence.id;
    group.position.copy(vector(evidence.position));
    group.rotation.set(evidence.rotation.x, evidence.rotation.y, evidence.rotation.z);
    const plane = new THREE.Mesh(
      new THREE.PlaneGeometry(evidence.size.width, evidence.size.height),
      this.createBasicMaterial(COLOR.soft, 0.32, { depthWrite: false, side: THREE.DoubleSide }),
    );
    group.add(plane);
    const edgeGeometry = new THREE.EdgesGeometry(plane.geometry);
    group.add(new THREE.LineSegments(edgeGeometry, this.createLineMaterial(COLOR.carbon, 0.14)));
    const grid: number[] = [];
    for (let row = 1; row < 7; row += 1) {
      const y = -evidence.size.height / 2 + (row / 7) * evidence.size.height;
      grid.push(-evidence.size.width / 2 + 42, y, 4, evidence.size.width / 2 - 42, y, 4);
    }
    for (let column = 1; column < 9; column += 1) {
      const x = -evidence.size.width / 2 + (column / 9) * evidence.size.width;
      grid.push(x, -evidence.size.height / 2 + 42, 4, x, evidence.size.height / 2 - 42, 4);
    }
    const gridGeometry = new THREE.BufferGeometry();
    gridGeometry.setAttribute("position", new THREE.Float32BufferAttribute(grid, 3));
    group.add(new THREE.LineSegments(gridGeometry, this.createLineMaterial(COLOR.carbon, 0.075)));
    this.evidenceGroups.set(evidence.districtId, group);
    this.projectionAnchors.set(
      evidence.id,
      vector(evidence.position).add(
        new THREE.Vector3(-evidence.size.width / 2 + 45, evidence.size.height / 2 - 38, 12),
      ),
    );
    world.add(group);
  }

  private createInstrument(world: THREE.Group, districtId: CapabilityDistrictId) {
    const origin = this.layout.districtOrigins[districtId];
    const group = new THREE.Group();
    group.position.set(origin.x, 260, origin.z - 3200);
    const ringMaterial = this.createLineMaterial(COLOR.carbon, 0.14);
    const ring = new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints(
        Array.from({ length: 96 }, (_, index) => {
          const angle = (index / 96) * Math.PI * 2;
          return new THREE.Vector3(Math.cos(angle) * 330, Math.sin(angle) * 330, 0);
        }),
      ),
      ringMaterial,
    );
    group.add(ring);
    const ticks: number[] = [];
    for (let index = 0; index < 48; index += 1) {
      const angle = (index / 48) * Math.PI * 2;
      const inner = index % 6 === 0 ? 355 : 368;
      const outer = index % 6 === 0 ? 402 : 388;
      ticks.push(Math.cos(angle) * inner, Math.sin(angle) * inner, 0);
      ticks.push(Math.cos(angle) * outer, Math.sin(angle) * outer, 0);
    }
    const tickGeometry = new THREE.BufferGeometry();
    tickGeometry.setAttribute("position", new THREE.Float32BufferAttribute(ticks, 3));
    group.add(new THREE.LineSegments(tickGeometry, this.createLineMaterial(COLOR.carbon, 0.12)));

    const crosshairGeometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-455, 0, -2),
      new THREE.Vector3(455, 0, -2),
      new THREE.Vector3(0, -455, -2),
      new THREE.Vector3(0, 455, -2),
    ]);
    group.add(
      new THREE.LineSegments(crosshairGeometry, this.createLineMaterial(COLOR.carbon, 0.065)),
    );

    const arcMaterial = this.createBasicMaterial(COLOR.carbon, 0.095, {
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    for (const [start, length] of [
      [0.12, 0.72],
      [2.08, 0.58],
      [4.18, 0.86],
    ] as const) {
      const arc = new THREE.Mesh(
        new THREE.RingGeometry(410, 427, 48, 1, start, length),
        arcMaterial,
      );
      arc.position.z = -4;
      group.add(arc);
    }
    group.visible = false;
    this.instrumentGroups.set(districtId, group);
    world.add(group);
  }

  private createDepthDust(world: THREE.Group) {
    let seed = 260806;
    const random = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    const points: number[] = [];
    for (let index = 0; index < 1400; index += 1) {
      points.push((random() - 0.5) * 44_000, 40 + random() * 1800, 1800 - random() * 34_000);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(points, 3));
    const material = new THREE.PointsMaterial({
      color: COLOR.muted,
      size: 3.2,
      transparent: true,
      opacity: 0.2,
      depthWrite: false,
      sizeAttenuation: true,
    });
    material.userData.baseOpacity = 0.2;
    world.add(new THREE.Points(geometry, material));
  }

  private createSurveyLines(world: THREE.Group) {
    const vertices: number[] = [];
    for (const origin of Object.values(this.layout.districtOrigins)) {
      vertices.push(origin.x, -28, origin.z + 2200, origin.x, -28, origin.z - 34_000);
      for (let depth = 0; depth < 8; depth += 1) {
        const z = origin.z - 2600 - depth * 4200;
        vertices.push(origin.x - 190, -28, z, origin.x + 190, -28, z);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
    world.add(new THREE.LineSegments(geometry, this.createLineMaterial(COLOR.carbon, 0.024)));
  }

  private updateFocusAppearance() {
    const selectedObject = this.activeObjectId
      ? this.nodeById.get(`object:${this.activeObjectId}`)
      : undefined;
    const resolvedBranchId = selectedObject?.branchId ?? this.activeBranchId;

    for (const [id, group] of this.nodeGroups) {
      const node = this.nodeById.get(id);
      if (!node) continue;
      const sameDistrict = node.districtId === this.activeDistrictId;
      const selected = node.objectId === this.activeObjectId;
      const visible =
        node.level === "district" ||
        (Boolean(this.activeDistrictId) &&
          sameDistrict &&
          (node.level === "branch" ||
            (node.level === "object" && node.branchId === resolvedBranchId)));
      group.visible = visible;
      if (!visible) continue;
      const contextFactor =
        node.level === "district" && this.activeDistrictId && !sameDistrict
          ? 0.34
          : node.level === "branch" && resolvedBranchId && node.branchId !== resolvedBranchId
            ? 0.42
            : node.level === "object" && !selected && this.activeObjectId
              ? 0.72
              : 1;
      this.setGroupOpacity(group, contextFactor);
      group.traverse((object) => {
        if (!object.userData.isAccent) return;
        object.visible =
          selected ||
          (!this.activeDistrictId && node.level === "district") ||
          (Boolean(this.activeDistrictId) && !resolvedBranchId && node.level === "district") ||
          (Boolean(resolvedBranchId) && node.level === "branch");
      });
    }

    for (const group of this.edgeGroups.values()) {
      const selectedPath = Boolean(
        this.activeObjectId && group.userData.objectId === this.activeObjectId,
      );
      const sameDistrict = group.userData.districtId === this.activeDistrictId;
      const isDistrictSpine = group.userData.kind === "spine" && !group.userData.branchId;
      const isActiveBranchSpine =
        group.userData.kind === "spine" &&
        resolvedBranchId &&
        group.userData.branchId === resolvedBranchId;
      const visible = Boolean(
        this.activeDistrictId &&
        sameDistrict &&
        (isDistrictSpine ||
          isActiveBranchSpine ||
          group.userData.kind === "trunk" ||
          (resolvedBranchId &&
            group.userData.kind === "branch" &&
            group.userData.branchId === resolvedBranchId)),
      );
      group.visible = visible;
      if (!visible) continue;
      this.setGroupOpacity(
        group,
        selectedPath
          ? 1
          : isActiveBranchSpine
            ? 0.94
            : isDistrictSpine
              ? resolvedBranchId
                ? 0.32
                : 0.86
              : group.userData.kind === "trunk" && resolvedBranchId
                ? 0.24
                : this.activeObjectId
                  ? 0.62
                  : 0.78,
      );
      group.traverse((object) => {
        if (object.userData.isSignal) object.visible = selectedPath;
      });
    }

    for (const [districtId, group] of this.evidenceGroups) {
      const visible = !this.activeDistrictId || districtId === this.activeDistrictId;
      group.visible = visible;
      if (!visible) continue;
      this.setGroupOpacity(
        group,
        !this.activeDistrictId ? 0.24 : this.activeObjectId ? 0.14 : resolvedBranchId ? 0.3 : 0.56,
      );
    }
    for (const [districtId, group] of this.instrumentGroups) {
      const visible = districtId === this.activeDistrictId;
      group.visible = visible;
      if (!visible) continue;
      const branch = resolvedBranchId
        ? this.nodeById.get(`branch:${districtId}:${resolvedBranchId}`)
        : undefined;
      const origin = branch?.position ?? this.layout.districtOrigins[districtId];
      group.position.set(origin.x + 120, 320, origin.z - (branch ? 3400 : 4200));
      this.setGroupOpacity(group, this.activeObjectId ? 0.34 : branch ? 0.82 : 0.64);
    }
    this.requestRender();
  }

  private setGroupOpacity(group: THREE.Object3D, factor: number) {
    group.traverse((object) => {
      for (const material of materialList(object)) {
        const baseOpacity = Number(material.userData.baseOpacity ?? material.opacity);
        material.transparent = baseOpacity * factor < 0.999;
        material.opacity = baseOpacity * factor;
        material.needsUpdate = true;
      }
    });
  }

  private animateTo(pose: CapabilityCameraPose, requestedDuration: number) {
    this.zoomLevel = 1;
    const targetFov = pose.fov ?? CAPABILITY_WORLD_CAMERA.fov;
    const duration = this.options.reducedMotion ? 0 : requestedDuration;
    if (duration <= 0) {
      this.camera.position.copy(vector(pose.position));
      this.target.copy(vector(pose.target));
      this.camera.fov = targetFov;
      this.camera.updateProjectionMatrix();
      this.camera.lookAt(this.target);
      this.transition = null;
      this.requestRender();
      return;
    }
    this.transition = {
      startedAt: performance.now(),
      duration,
      fromPosition: this.camera.position.clone(),
      fromTarget: this.target.clone(),
      fromFov: this.camera.fov,
      toPosition: vector(pose.position),
      toTarget: vector(pose.target),
      toFov: targetFov,
    };
    this.requestRender();
  }

  private render = (timestamp: number) => {
    this.animationFrame = null;
    if (this.disposed) return;
    let continuing = false;
    if (this.transition) {
      const progress = Math.min(
        1,
        (timestamp - this.transition.startedAt) / this.transition.duration,
      );
      const eased = easeOutQuint(progress);
      this.camera.position.lerpVectors(
        this.transition.fromPosition,
        this.transition.toPosition,
        eased,
      );
      this.target.lerpVectors(this.transition.fromTarget, this.transition.toTarget, eased);
      this.camera.fov = THREE.MathUtils.lerp(this.transition.fromFov, this.transition.toFov, eased);
      this.camera.updateProjectionMatrix();
      this.camera.lookAt(this.target);
      if (progress >= 1) this.transition = null;
      else continuing = true;
    }
    for (const group of this.instrumentGroups.values()) {
      group.quaternion.copy(this.camera.quaternion);
    }
    this.renderer.render(this.scene, this.camera);
    this.projectLabels();
    this.options.onViewChange({
      targetX: this.target.x,
      targetZ: this.target.z,
      zoom: this.zoomLevel,
    });
    if (continuing) this.requestRender();
  };

  private requestRender() {
    if (this.disposed || this.animationFrame != null) return;
    this.animationFrame = requestAnimationFrame(this.render);
  }

  private resize() {
    const rect = this.canvas.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.requestRender();
  }

  private projectLabels() {
    const rect = this.canvas.getBoundingClientRect();
    for (const [id, element] of this.labelElements) {
      const node = this.nodeById.get(id);
      const anchor = this.projectionAnchors.get(id);
      if (!anchor) continue;
      const projected = anchor.clone().project(this.camera);
      const x = (projected.x * 0.5 + 0.5) * rect.width;
      const y = (-projected.y * 0.5 + 0.5) * rect.height;
      const inView =
        projected.z > -1 &&
        projected.z < 1 &&
        x > -260 &&
        x < rect.width + 260 &&
        y > -160 &&
        y < rect.height + 160;
      element.style.setProperty("--capability-label-x", `${x.toFixed(2)}px`);
      element.style.setProperty("--capability-label-y", `${y.toFixed(2)}px`);
      element.style.setProperty(
        "--capability-label-depth",
        `${Math.round((1 - projected.z) * 500)}`,
      );
      if (node) {
        const referenceDistance = Math.max(1, this.camera.position.distanceTo(this.target));
        const nodeDistance = Math.max(1, this.camera.position.distanceTo(anchor));
        const scale = THREE.MathUtils.clamp(referenceDistance / nodeDistance, 0.58, 1.14);
        const air = 0.78 + THREE.MathUtils.clamp((scale - 0.58) / 0.56, 0, 1) * 0.22;
        element.style.removeProperty("--capability-label-transform");
        element.style.setProperty("--capability-label-scale", scale.toFixed(4));
        element.style.setProperty("--capability-label-air", air.toFixed(4));
        element.dataset.presentation = "billboard";
        element.dataset.distance =
          node.level === "district" ? "near" : scale < 0.7 ? "far" : scale < 0.88 ? "mid" : "near";
      }
      element.dataset.projected = inView ? "true" : "false";
    }
  }

  private applyZoom(deltaY: number) {
    this.transition = null;
    const nextZoom = THREE.MathUtils.clamp(
      this.zoomLevel * Math.exp(-deltaY * CAPABILITY_WORLD_CAMERA.wheelSensitivity),
      CAPABILITY_WORLD_CAMERA.minimumZoom,
      CAPABILITY_WORLD_CAMERA.maximumZoom,
    );
    const ratio = this.zoomLevel / nextZoom;
    const offset = this.camera.position.clone().sub(this.target).multiplyScalar(ratio);
    this.camera.position.copy(this.target).add(offset);
    this.zoomLevel = nextZoom;
    this.camera.lookAt(this.target);
    this.requestRender();
  }

  private travelDepth(deltaY: number) {
    this.transition = null;
    const distance = deltaY * CAPABILITY_WORLD_CAMERA.wheelDepthSensitivity;
    this.camera.position.z -= distance;
    this.target.z -= distance;
    this.camera.lookAt(this.target);
    this.requestRender();
  }

  private handlePointerDown = (event: PointerEvent) => {
    if (event.button !== 0) return;
    this.transition = null;
    this.pointerGesture = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      previousX: event.clientX,
      previousY: event.clientY,
      dragged: false,
    };
    this.canvas.setPointerCapture(event.pointerId);
    this.canvas.dataset.dragging = "true";
  };

  private handlePointerMove = (event: PointerEvent) => {
    const gesture = this.pointerGesture;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    const previousX = gesture.previousX;
    const previousY = gesture.previousY;
    const dx = event.clientX - previousX;
    const dy = event.clientY - previousY;
    gesture.previousX = event.clientX;
    gesture.previousY = event.clientY;
    if (Math.hypot(event.clientX - gesture.startX, event.clientY - gesture.startY) > 5) {
      gesture.dragged = true;
    }
    if (!gesture.dragged) return;
    const before = this.intersectDragPlane(previousX, previousY);
    const after = this.intersectDragPlane(event.clientX, event.clientY);
    const translation =
      before && after
        ? before.sub(after).multiplyScalar(CAPABILITY_WORLD_CAMERA.dragSensitivity)
        : new THREE.Vector3(-dx * 2.4, 0, -dy * 2.4).multiplyScalar(
            CAPABILITY_WORLD_CAMERA.dragSensitivity,
          );
    translation.y = 0;
    this.camera.position.add(translation);
    this.target.add(translation);
    this.camera.lookAt(this.target);
    this.requestRender();
  };

  private intersectDragPlane(clientX: number, clientY: number) {
    const rect = this.canvas.getBoundingClientRect();
    this.pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    return this.raycaster.ray.intersectPlane(this.dragPlane, new THREE.Vector3());
  }

  private handlePointerUp = (event: PointerEvent) => {
    const gesture = this.pointerGesture;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    this.pointerGesture = null;
    this.canvas.dataset.dragging = "false";
    if (this.canvas.hasPointerCapture(event.pointerId))
      this.canvas.releasePointerCapture(event.pointerId);
    if (!gesture.dragged) this.pickNode(event.clientX, event.clientY);
  };

  private handlePointerCancel = (event: PointerEvent) => {
    if (this.pointerGesture?.pointerId !== event.pointerId) return;
    this.pointerGesture = null;
    this.canvas.dataset.dragging = "false";
  };

  private handleWheel = (event: WheelEvent) => {
    event.preventDefault();
    const normalizedDelta =
      (Math.abs(event.deltaY) >= Math.abs(event.deltaX) ? event.deltaY : event.deltaX) *
      (event.deltaMode === WheelEvent.DOM_DELTA_LINE
        ? 16
        : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
          ? Math.max(1, this.canvas.clientHeight)
          : 1);
    this.travelDepth(THREE.MathUtils.clamp(normalizedDelta, -320, 320));
  };

  private pickNode(clientX: number, clientY: number) {
    const rect = this.canvas.getBoundingClientRect();
    this.pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hit = this.raycaster.intersectObjects(this.pickables, false)[0];
    const nodeId = hit?.object.userData.nodeId as string | undefined;
    const node = nodeId ? this.nodeById.get(nodeId) : undefined;
    if (node) this.options.onPick(node);
  }

  private bindEvents() {
    this.canvas.addEventListener("pointerdown", this.handlePointerDown);
    this.canvas.addEventListener("pointermove", this.handlePointerMove);
    this.canvas.addEventListener("pointerup", this.handlePointerUp);
    this.canvas.addEventListener("pointercancel", this.handlePointerCancel);
    this.canvas.addEventListener("wheel", this.handleWheel, { passive: false });
  }

  private unbindEvents() {
    this.canvas.removeEventListener("pointerdown", this.handlePointerDown);
    this.canvas.removeEventListener("pointermove", this.handlePointerMove);
    this.canvas.removeEventListener("pointerup", this.handlePointerUp);
    this.canvas.removeEventListener("pointercancel", this.handlePointerCancel);
    this.canvas.removeEventListener("wheel", this.handleWheel);
  }
}
