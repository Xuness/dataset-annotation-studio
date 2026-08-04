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

export const ANNOTATION_LANE_IDS = ["tags", "description", "translation"] as const;

export type AnnotationLaneId = (typeof ANNOTATION_LANE_IDS)[number];

export const ANNOTATION_EDIT_CHANNEL_IDS = [
  "existing_annotation",
  "tags",
  "description",
  "translation",
] as const;

export type AnnotationEditChannelId = (typeof ANNOTATION_EDIT_CHANNEL_IDS)[number];

export interface AnnotationProjectContext {
  id: string;
  name: string;
  rootPath: string;
  exists: boolean;
  assetCount: number;
  annotatedCount: number;
  invalidCount: number;
}

export interface AnnotationAssetSample {
  id: string;
  filename: string;
  relativePath: string;
  width: number;
  height: number;
  imageUrl: string;
  thumbnailUrl: string;
  annotationStatus: string;
  channelStatuses: Readonly<Record<string, string>>;
}

export interface AnnotationCoverageLane {
  id: AnnotationLaneId;
  activeDocumentCount: number;
  presentAssetCount: number;
  usableAssetCount: number;
  staleAssetCount: number;
  invalidAssetCount: number;
  missingAssetCount: number;
  coveragePercent: number;
}

export interface AnnotationTranslationVariant {
  id: string;
  language: string;
  sourceKind: "description" | "tags";
  producerKind: "llm" | "local_dictionary";
  displayName: string;
  presentAssetCount: number;
  usableAssetCount: number;
  staleAssetCount: number;
  invalidAssetCount: number;
  missingAssetCount: number;
}

export type AnnotationContextSignalId =
  | "system-prompt"
  | "user-context"
  | "tags-context"
  | "json-fields"
  | "provider"
  | "tagger"
  | "translation-prompt"
  | "dictionary";

export interface AnnotationContextSignal {
  id: AnnotationContextSignalId;
  state: "ready" | "attention" | "loading" | "error";
  value: string;
  detail: string;
}

export interface AnnotationOperationSummary {
  id: string;
  kind: "annotation" | "translation";
  lane: AnnotationLaneId | null;
  status: string;
  statusLabel: string;
  progressPercent: number;
  completedItems: number;
  totalItems: number;
  failedItems: number;
  targetLanguage: string | null;
  executionProfileName: string;
  model: string;
  createdAt: string;
  updatedAt: string;
  active: boolean;
}

export interface AnnotationSpaceContent {
  kind: "annotation";
  status: "no-context" | "loading" | "ready" | "error";
  project: AnnotationProjectContext | null;
  samples: readonly AnnotationAssetSample[];
  checkedCount: number;
  channels: readonly AnnotationCoverageLane[];
  translationVariants: readonly AnnotationTranslationVariant[];
  contextSignals: readonly AnnotationContextSignal[];
  operation: AnnotationOperationSummary | null;
  message: string | null;
  openArchive(): void;
  openWorkbench(assetId?: string, lane?: AnnotationLaneId): void;
  openProduction(lane?: AnnotationLaneId, operationId?: string): void;
}

export const ANNOTATION_WORKCELL_IDS = ["edit", "production", "dossier"] as const;

export type AnnotationWorkcellId = (typeof ANNOTATION_WORKCELL_IDS)[number];

export interface AnnotationStageAsset {
  id: string;
  filename: string;
  relativePath: string;
  width: number;
  height: number;
  byteSize: number;
  suffix: string;
  imageUrl: string;
  thumbnailUrl: string;
  annotationStatus: string;
  channelStatuses: Readonly<Record<string, string>>;
}

export interface AnnotationStageSequence {
  assets: readonly AnnotationStageAsset[];
  totalCount: number;
  loadedCount: number;
  fetchingMore: boolean;
  hasMore: boolean;
  loadError: string | null;
  loadMore(): void;
}

export interface AnnotationEditChannelOption {
  id: AnnotationEditChannelId;
  code: string;
  title: string;
  shortTitle: string;
  state: "missing" | "usable" | "stale" | "invalid" | "reviewed";
  stateLabel: string;
  enabled: boolean;
}

export interface AnnotationEditDocumentReading {
  displayName: string;
  exists: boolean;
  availability: "missing" | "usable" | "stale" | "invalid";
  availabilityLabel: string;
  reviewStatus: "unreviewed" | "reviewed" | null;
  sourceLabel: string | null;
  modifiedAt: string | null;
  validationIssue: string | null;
}

export interface AnnotationEditTokenMetric {
  id: string;
  label: string;
  shortLabel: string;
  count: number;
}

export interface AnnotationEditTagItem {
  key: string;
  name: string;
  category: string | null;
  categoryLabel: string;
  confidence: number | null;
  origin: string;
  highlighted: boolean;
  armed: boolean;
}

export interface AnnotationEditTagGroup {
  id: string;
  category: string | null;
  label: string;
  tone: "accent" | "sage" | "warning" | "danger" | "neutral";
  items: readonly AnnotationEditTagItem[];
}

export interface AnnotationEditTagSuggestion {
  id: string;
  name: string;
  category: string | null;
  categoryLabel: string;
  translation: string | null;
  translationPending: boolean;
  exists: boolean;
}

export interface AnnotationEditVocabularyOption {
  id: string;
  label: string;
  detail: string;
}

export interface AnnotationEditTagSurface {
  groups: readonly AnnotationEditTagGroup[];
  count: number;
  query: string;
  statusMessage: string;
  vocabularyId: string;
  vocabularies: readonly AnnotationEditVocabularyOption[];
  suggestions: readonly AnnotationEditTagSuggestion[];
  suggestionsOpen: boolean;
  suggestionsPending: boolean;
  suggestionsError: string | null;
  activeSuggestion: number;
  setQuery(value: string): void;
  setSuggestionsOpen(open: boolean): void;
  setActiveSuggestion(index: number): void;
  setVocabulary(id: string): void;
  addQuery(value?: string): void;
  addSuggestion(index: number): void;
  removeTag(key: string): void;
  handleEmptyBackspace(): void;
}

export interface AnnotationEditTranslationSurface {
  language: string;
  languageOptions: readonly string[];
  sourceKind: "description" | "tags";
  producerKind: "llm" | "local_dictionary";
  sourceContent: string;
  sourceExists: boolean;
  status: string;
  statusLabel: string;
  alignmentStatus: string;
  issue: string | null;
  qualityIssues: readonly string[];
  readOnly: boolean;
  editing: boolean;
  canEdit: boolean;
  canRefreshDictionary: boolean;
  dictionaryOverrideCount: number;
  dictionaryUnmatchedCount: number;
  setLanguage(language: string): void;
  setSourceKind(source: "description" | "tags"): void;
  setProducerKind(producer: "llm" | "local_dictionary"): void;
  beginEditing(): void;
  refreshDictionary(): Promise<void>;
}

export interface AnnotationEditHistoryEntry {
  id: string;
  sourceLabel: string;
  createdAt: string;
  preview: string;
  candidate: boolean;
  tombstone: boolean;
  restorable: boolean;
}

export interface AnnotationEditHistory {
  open: boolean;
  status: "idle" | "loading" | "ready" | "error";
  message: string | null;
  entries: readonly AnnotationEditHistoryEntry[];
  toggle(): void;
  restore(revisionId: string): void;
}

export interface AnnotationEditTokenProfileOption {
  id: string;
  label: string;
}

export interface AnnotationEditContent {
  status: "no-object" | "loading" | "ready" | "error";
  message: string | null;
  channel: AnnotationEditChannelId;
  channels: readonly AnnotationEditChannelOption[];
  document: AnnotationEditDocumentReading;
  text: string;
  textPlaceholder: string;
  characterCount: number;
  lineCount: number;
  tokenProfileId: string;
  tokenProfiles: readonly AnnotationEditTokenProfileOption[];
  tokenMetrics: readonly AnnotationEditTokenMetric[];
  tokenMetricsPending: boolean;
  tags: AnnotationEditTagSurface;
  translation: AnnotationEditTranslationSurface;
  history: AnnotationEditHistory;
  dirty: boolean;
  tagsDirty: boolean;
  writePending: boolean;
  saveLabel: string;
  canSave: boolean;
  canDiscard: boolean;
  actionError: string | null;
  setText(value: string): void;
  selectChannel(channel: AnnotationEditChannelId): Promise<void>;
  selectTokenProfile(profileId: string): void;
  save(): Promise<void>;
  discard(): Promise<void>;
}

export type AnnotationProductionBackendId = "provider" | "local_tagger" | "local_dictionary";

export interface AnnotationProductionOption {
  id: string;
  label: string;
  detail?: string;
  disabled?: boolean;
}

export interface AnnotationProductionLaneReading {
  id: AnnotationLaneId;
  code: string;
  title: string;
  summary: string;
  coveragePercent: number;
  usableAssetCount: number;
  missingAssetCount: number;
  state: "ready" | "attention" | "inactive" | "running" | "complete";
}

export interface AnnotationProductionSnapshotField {
  id: string;
  label: string;
  value: string;
  detail?: string;
  tone?: "default" | "attention" | "signal";
}

export interface AnnotationProductionConfiguration {
  scope: "all" | "selected";
  scopeCount: number;
  totalCount: number;
  selectedCount: number;
  backend: AnnotationProductionBackendId;
  backendOptions: readonly AnnotationProductionOption[];
  providerProfileId: string;
  providerProfileOptions: readonly AnnotationProductionOption[];
  modelId: string;
  modelOptions: readonly AnnotationProductionOption[];
  taggerProfileId: string;
  taggerProfileOptions: readonly AnnotationProductionOption[];
  promptPresetId: string;
  promptPresetOptions: readonly AnnotationProductionOption[];
  targetLanguage: string;
  targetLanguageOptions: readonly AnnotationProductionOption[];
  translationSource: "description" | "tags";
  translationPolicy: "skip" | "stale" | "overwrite";
  snapshot: readonly AnnotationProductionSnapshotField[];
  blockers: readonly string[];
  ready: boolean;
  pending: boolean;
  setScope(scope: "all" | "selected"): void;
  setBackend(backend: AnnotationProductionBackendId): void;
  setProviderProfile(profileId: string): void;
  setModel(modelId: string): void;
  setTaggerProfile(profileId: string): void;
  setPromptPreset(presetId: string): void;
  setTargetLanguage(language: string): void;
  setTranslationSource(source: "description" | "tags"): void;
  setTranslationPolicy(policy: "skip" | "stale" | "overwrite"): void;
  create(): Promise<void>;
}

export interface AnnotationProductionException {
  id: string;
  assetId: string;
  relativePath: string;
  status: string;
  attemptCount: number;
  message: string;
  diagnostic: string | null;
  candidate: boolean;
  canAccept: boolean;
}

export interface AnnotationProductionOperation {
  id: string;
  lane: AnnotationLaneId;
  status: string;
  statusLabel: string;
  tone: "active" | "success" | "attention" | "idle";
  progressPercent: number;
  total: number;
  pending: number;
  running: number;
  succeeded: number;
  failed: number;
  skipped: number;
  candidates: number;
  manuallyAccepted: number;
  executionProfile: string;
  model: string;
  outputChannel: string;
  scopeLabel: string;
  createdAt: string;
  updatedAt: string;
  snapshot: readonly AnnotationProductionSnapshotField[];
  exceptions: readonly AnnotationProductionException[];
  exceptionCount: number;
  loadingMore: boolean;
  canLoadMore: boolean;
  canStop: boolean;
  stopping: boolean;
  canResume: boolean;
  canRetry: boolean;
  actionPending: boolean;
  stop(): Promise<void>;
  resume(): Promise<void>;
  retry(): Promise<void>;
  accept(exceptionId: string): Promise<void>;
  loadMore(): void;
}

export interface AnnotationProductionContent {
  status: "inactive" | "loading" | "configure" | "operation" | "error";
  lane: AnnotationLaneId;
  lanes: readonly AnnotationProductionLaneReading[];
  configuration: AnnotationProductionConfiguration;
  operation: AnnotationProductionOperation | null;
  message: string | null;
  selectLane(lane: AnnotationLaneId): void;
  createNew(): void;
}

export interface AnnotationConfirmation {
  title: string;
  message: string;
  tone: "default" | "danger";
  confirmLabel: string;
  cancelLabel: string;
}

export interface AnnotationStageContent {
  kind: "annotation-stage";
  status: "no-context" | "loading" | "ready" | "error";
  project: AnnotationProjectContext | null;
  sequence: AnnotationStageSequence;
  currentAsset: AnnotationStageAsset | null;
  currentIndex: number;
  checkedAssetIds: readonly string[];
  channels: readonly AnnotationCoverageLane[];
  operation: AnnotationOperationSummary | null;
  activeWorkcell: AnnotationWorkcellId | null;
  activeEditChannel: AnnotationEditChannelId;
  edit: AnnotationEditContent | null;
  production: AnnotationProductionContent | null;
  confirmation: AnnotationConfirmation | null;
  message: string | null;
  selectAsset(assetId: string): void;
  stepAsset(offset: number): void;
  toggleAssetChecked(assetId: string): void;
  openWorkcell(workcell: AnnotationWorkcellId): void;
  closeWorkcell(): void;
  selectEditChannel(channel: AnnotationEditChannelId): void;
  resolveConfirmation(accepted: boolean): void;
  returnToSpace(): void;
  openArchive(): void;
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
  | ArchiveSpaceContent
  | AnnotationSpaceContent
  | AnnotationStageContent
  | PreparationSpaceContent
  | PreparationWorkbenchContent
  | PendingSpaceContent;

export interface SpacePageFrame {
  space: HomeSpace;
  content: SpacePageContent;
}
