import type { HomeSpace } from "../../navigation/spaceRegistry";
import type { PreprocessFormState } from "../../../application/preprocessing/preprocessState";

export interface ArchiveProjectRecord {
  id: string;
  name: string;
  rootPath: string;
  exists: boolean;
  assetCount: number;
  annotatedCount: number;
  invalidCount: number;
  createdAt: string;
  lastOpenedAt: string | null;
}

export interface ArchiveSpaceContent {
  kind: "archive";
  status: "loading" | "ready" | "error";
  projects: readonly ArchiveProjectRecord[];
  activeProjectId: string | null;
  message: string | null;
  registering: boolean;
  removingProjectId: string | null;
  registerProject(): Promise<string | null>;
  loadProject(projectId: string): void;
  revealProject(projectId: string): Promise<void>;
  removeProject(projectId: string): Promise<void>;
  clearMessage(): void;
}

export interface PendingSpaceContent {
  kind: "pending";
}

export const PREPARATION_CAPABILITY_IDS = ["geometry", "encoding", "identity"] as const;

export type PreparationCapabilityId = (typeof PREPARATION_CAPABILITY_IDS)[number];

export const PREPARATION_CANVAS_NODE_IDS = [
  "source",
  "scope",
  ...PREPARATION_CAPABILITY_IDS,
  "preview",
  "commit",
  "recovery",
] as const;

export type PreparationCanvasNodeId = (typeof PREPARATION_CANVAS_NODE_IDS)[number];

export interface PreparationProjectContext {
  id: string;
  name: string;
  rootPath: string;
  exists: boolean;
  assetCount: number;
  invalidCount: number;
}

export interface PreparationAssetSample {
  id: string;
  filename: string;
  relativePath: string;
  width: number;
  height: number;
  thumbnailUrl: string;
}

export interface PreparationOperationSummary {
  id: string;
  status: string;
  statusLabel: string;
  stageLabel: string;
  itemCount: number;
  completedItems: number;
  progressPercent: number;
  determinate: boolean;
  currentRelativePath: string | null;
  etaSeconds: number | null;
  createdAt: string;
  completedAt: string | null;
  errorMessage: string | null;
  capabilities: readonly PreparationCapabilityId[];
  optionSummary: readonly string[];
  backendLabel: string;
  canRecover: boolean;
}

export interface PreparationSpaceContent {
  kind: "preparation";
  status: "no-context" | "loading" | "ready" | "error";
  project: PreparationProjectContext | null;
  samples: readonly PreparationAssetSample[];
  checkedCount: number;
  activeOperation: PreparationOperationSummary | null;
  recentOperation: PreparationOperationSummary | null;
  recoverableOperation: PreparationOperationSummary | null;
  message: string | null;
  openArchive(): void;
  openWorkbench(focus?: PreparationCapabilityId): void;
  openOperation(operationId: string, focus?: PreparationCanvasNodeId): void;
}

export interface PreparationPreviewItem {
  assetId: string;
  beforeRelativePath: string;
  afterRelativePath: string;
  beforeWidth: number;
  beforeHeight: number;
  afterWidth: number;
  afterHeight: number;
  willChange: boolean;
  warning: string | null;
}

export interface PreparationPreviewSummary {
  totalItems: number;
  changedCount: number;
  unchangedCount: number;
  warningCount: number;
  truncated: boolean;
  items: readonly PreparationPreviewItem[];
}

export interface PreparationExecutionPlanSummary {
  backendId: string;
  routeCounts: Readonly<Record<string, number>>;
  effectiveWorkers: number;
  effectiveBatchSize: number;
}

export interface PreparationBackendOption {
  id: string;
  label: string;
  status: "ready" | "degraded" | "unavailable";
  deviceName: string | null;
}

export interface PreparationConfirmation {
  title: string;
  message: string;
  tone: "default" | "danger";
  confirmLabel: string;
  cancelLabel: string;
}

export interface PreparationWorkbenchContent {
  kind: "preparation-workbench";
  status: "no-context" | "loading" | "ready" | "error";
  project: PreparationProjectContext | null;
  samples: readonly PreparationAssetSample[];
  initialFocus: PreparationCanvasNodeId;
  form: Readonly<PreprocessFormState>;
  assetCount: number;
  checkedCount: number;
  preview: PreparationPreviewSummary | null;
  previewPending: boolean;
  executionPlan: PreparationExecutionPlanSummary | null;
  executionPlanPending: boolean;
  executionPlanError: string | null;
  backends: readonly PreparationBackendOption[];
  backendsPending: boolean;
  operations: readonly PreparationOperationSummary[];
  activeOperation: PreparationOperationSummary | null;
  selectedOperation: PreparationOperationSummary | null;
  workspaceBusy: boolean;
  error: string | null;
  confirmation: PreparationConfirmation | null;
  updateForm(update: Partial<PreprocessFormState>): void;
  previewAction(): Promise<void>;
  executeAction(): Promise<void>;
  selectOperation(operationId: string | null): void;
  undoAction(operationId: string): Promise<void>;
  resolveConfirmation(accepted: boolean): void;
  returnToSpace(): void;
  openArchive(): void;
}

export type SpacePageContent =
  ArchiveSpaceContent | PreparationSpaceContent | PreparationWorkbenchContent | PendingSpaceContent;

export interface SpacePageFrame {
  space: HomeSpace;
  content: SpacePageContent;
}
