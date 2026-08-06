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

export const ANNOTATION_DOSSIER_SECTION_IDS = [
  "channels",
  "metadata",
  "revisions",
  "translations",
  "jobs",
  "provenance",
] as const;

export type AnnotationDossierSectionId = (typeof ANNOTATION_DOSSIER_SECTION_IDS)[number];

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

export type AnnotationStageFilterId = "all" | "missing" | "stale" | "invalid" | "failed";

export interface AnnotationStageFilterOption {
  id: AnnotationStageFilterId;
  label: string;
  code: string;
}

export interface AnnotationStageScope {
  search: string;
  filter: AnnotationStageFilterId;
  filters: readonly AnnotationStageFilterOption[];
  selectingAll: boolean;
  actionError: string | null;
  setSearch(value: string): void;
  setFilter(filter: AnnotationStageFilterId): void;
  toggleRangeTo(assetId: string): void;
  clearChecked(): void;
  selectAllFiltered(): Promise<void>;
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

export interface AnnotationEditTranslationPart {
  id: string;
  kind: "segment" | "tag";
  sourceText: string;
  translatedText: string;
  category: string | null;
  confidence: number | null;
}

export interface AnnotationEditTranslationComparison {
  aligned: boolean;
  sourceMode: "plain" | "segments" | "tags";
  sourceText: string;
  translatedText: string;
  parts: readonly AnnotationEditTranslationPart[];
  activeIds: readonly string[];
  pinned: boolean;
  dictionaryState: "idle" | "loading" | "ready" | "error";
  dictionaryMessage: string | null;
  setHover(id: string | null): void;
  pin(ids: readonly string[]): void;
  clearPin(): void;
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
  translationComparison: AnnotationEditTranslationComparison;
  history: AnnotationEditHistory;
  dirty: boolean;
  tagsDirty: boolean;
  writePending: boolean;
  saveLabel: string;
  canSave: boolean;
  canDiscard: boolean;
  canDelete: boolean;
  deletePending: boolean;
  actionError: string | null;
  setText(value: string): void;
  selectChannel(channel: AnnotationEditChannelId): Promise<void>;
  selectTokenProfile(profileId: string): void;
  save(): Promise<void>;
  discard(): Promise<void>;
  deleteCurrent(): Promise<void>;
}

export interface AnnotationProjectContextPresetOption {
  id: string;
  name: string;
  systemPrompt: string;
}

export interface AnnotationProjectMetadataField {
  id: string;
  selected: boolean;
}

export interface AnnotationProjectContextContent {
  status: "loading" | "ready" | "error";
  message: string | null;
  systemPresetId: string;
  systemPresets: readonly AnnotationProjectContextPresetOption[];
  selectedSystemPrompt: string;
  userPrompt: string;
  useTagsAsContext: boolean;
  metadataStatus: "no-object" | "loading" | "missing" | "ready" | "error";
  metadataPath: string | null;
  metadataFields: readonly AnnotationProjectMetadataField[];
  metadataRaw: string | null;
  dirty: boolean;
  writePending: boolean;
  canSave: boolean;
  actionError: string | null;
  setSystemPreset(id: string): void;
  setUserPrompt(value: string): void;
  setUseTagsAsContext(value: boolean): void;
  toggleMetadataField(field: string): void;
  save(): Promise<void>;
  discard(): void;
}

export interface AnnotationRequestPreviewContent {
  status: "no-object" | "loading" | "ready" | "error";
  message: string | null;
  basedOnSavedContext: boolean;
  configurationIssue: string | null;
  systemPresetName: string | null;
  systemPrompt: string;
  userPrompt: string;
  finalUserPrompt: string;
  metadataLines: readonly string[];
  tagContextStatus: "disabled" | "ready" | "unavailable";
  tagCount: number;
  tagLine: string | null;
}

export type AnnotationBatchTagMode = "add" | "remove" | "replace";
export type AnnotationBatchInsertPosition = "start" | "end" | "index" | "before" | "after";

export interface AnnotationBatchPreviewItem {
  id: string;
  filename: string;
  relativePath: string;
  before: string;
  after: string;
  changed: boolean;
  positionSkipped: boolean;
}

export interface AnnotationBatchTagContent {
  mode: AnnotationBatchTagMode;
  addDraft: string;
  removeDraft: string;
  sourceDraft: string;
  replacementDraft: string;
  insertPosition: AnnotationBatchInsertPosition;
  insertIndex: string;
  insertAnchor: string;
  modeDescription: string;
  requestError: string | null;
  notice: string | null;
  busy: boolean;
  canPreview: boolean;
  canExecute: boolean;
  preview: {
    requestedCount: number;
    changedCount: number;
    unchangedCount: number;
    positionSkippedCount: number;
    items: readonly AnnotationBatchPreviewItem[];
  } | null;
  setMode(mode: AnnotationBatchTagMode): void;
  setAddDraft(value: string): void;
  setRemoveDraft(value: string): void;
  setSourceDraft(value: string): void;
  setReplacementDraft(value: string): void;
  setInsertPosition(position: AnnotationBatchInsertPosition): void;
  setInsertIndex(value: string): void;
  setInsertAnchor(value: string): void;
  previewChanges(): Promise<void>;
  executeChanges(): Promise<void>;
}

export interface AnnotationBatchDeleteOption {
  id: string;
  label: string;
  activeCount: number;
  staleCount: number;
  selected: boolean;
  disabled: boolean;
}

export interface AnnotationBatchDeleteContent {
  status: "idle" | "loading" | "ready" | "error";
  options: readonly AnnotationBatchDeleteOption[];
  selectedCount: number;
  busy: boolean;
  actionError: string | null;
  notice: string | null;
  toggle(id: string): void;
  toggleAll(): void;
  execute(): Promise<void>;
}

export interface AnnotationBatchContent {
  rangeCount: number;
  effectiveAssetIds: readonly string[];
  tags: AnnotationBatchTagContent;
  deletion: AnnotationBatchDeleteContent;
}

export interface AnnotationDossierDocument {
  id: string;
  code: string;
  title: string;
  status: string;
  statusLabel: string;
  availability: string;
  language: string | null;
  source: string | null;
  reviewStatus: string | null;
  updatedAt: string | null;
  revisionId: string | null;
  imageHash: string | null;
  validationMessage: string | null;
}

export interface AnnotationDossierMetadataField {
  id: string;
  label: string;
  value: string;
  kind: string;
}

export interface AnnotationDossierMetadata {
  exists: boolean;
  path: string | null;
  fields: readonly AnnotationDossierMetadataField[];
  raw: string | null;
  error: string | null;
}

export interface AnnotationDossierRevision {
  id: string;
  channel: string;
  channelLabel: string;
  source: string;
  createdAt: string;
  preview: string;
  candidate: boolean;
  tombstone: boolean;
  validationStatus: string;
  jobItemId: string | null;
  imageHash: string | null;
}

export interface AnnotationDossierTranslation {
  id: string;
  language: string;
  sourceKind: string;
  producerKind: string;
  status: string;
  statusLabel: string;
  producer: string;
  model: string | null;
  provider: string | null;
  updatedAt: string | null;
  sourceRevisionId: string | null;
  sourceHash: string | null;
  currentSourceHash: string | null;
  qualityStatus: string;
  alignmentStatus: string;
  issue: string | null;
  qualityIssues: readonly string[];
}

export interface AnnotationDossierReading {
  id: string;
  label: string;
  value: string;
  detail?: string;
  tone?: "default" | "signal" | "attention";
}

export interface AnnotationDossierProvenance {
  id: string;
  code: string;
  title: string;
  model: string;
  executionBackend: string;
  outputChannel: string;
  startedAt: string;
  source: string | null;
  current: boolean;
  readings: readonly AnnotationDossierReading[];
  requestJson: string;
  responseJson: string;
}

export interface AnnotationDossierJob {
  id: string;
  itemId: string;
  kind: string;
  kindLabel: string;
  jobStatus: string;
  jobStatusLabel: string;
  itemStatus: string;
  itemStatusLabel: string;
  resultDisposition: string;
  executionProfile: string;
  model: string;
  outputChannel: string;
  attemptCount: number;
  createdAt: string;
  updatedAt: string;
  error: string | null;
}

export interface AnnotationDossierContent {
  status: "inactive" | "no-object" | "loading" | "ready" | "error";
  message: string | null;
  documents: readonly AnnotationDossierDocument[];
  metadata: AnnotationDossierMetadata;
  revisions: readonly AnnotationDossierRevision[];
  translations: readonly AnnotationDossierTranslation[];
  provenance: AnnotationDossierProvenance | null;
  provenanceHistory: readonly AnnotationDossierProvenance[];
  selectedProvenanceId: string | null;
  provenanceLoading: boolean;
  provenanceIssue: string | null;
  jobs: readonly AnnotationDossierJob[];
  jobsLoading: boolean;
  jobsIssue: string | null;
  selectProvenance(traceId: string): void;
  openJob(jobId: string): void;
  openArchive(): void;
  openQuality(): void;
}

export type AnnotationProductionBackendId = "provider" | "local_tagger" | "local_dictionary";
export type AnnotationProductionScopeId = "all" | "selected" | "folder";

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
  scope: AnnotationProductionScopeId;
  scopeCount: number;
  totalCount: number;
  selectedCount: number;
  folderPath: string;
  folderOptions: readonly AnnotationProductionOption[];
  folderLoading: boolean;
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
  setScope(scope: AnnotationProductionScopeId): void;
  setFolderPath(folderPath: string): void;
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
  entryIntent: "overview" | "lane" | "operation";
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

/**
 * Stage data is grouped by the surface that owns it. The shell keeps the
 * specimen, sequence and project identity alive while routes only switch the
 * active workcell model.
 */
export interface AnnotationStageOverviewContent {
  batch: AnnotationBatchContent | null;
}

export interface AnnotationEditWorkcellContent {
  channel: AnnotationEditChannelId;
  editor: AnnotationEditContent | null;
}

export interface AnnotationProductionWorkcellContent {
  production: AnnotationProductionContent | null;
  projectContext: AnnotationProjectContextContent | null;
  requestPreview: AnnotationRequestPreviewContent | null;
}

export interface AnnotationDossierWorkcellContent {
  section: AnnotationDossierSectionId;
  dossier: AnnotationDossierContent | null;
}

export interface AnnotationStageContent {
  kind: "annotation-stage";
  status: "no-context" | "loading" | "ready" | "error";
  project: AnnotationProjectContext | null;
  sequence: AnnotationStageSequence;
  scope: AnnotationStageScope;
  currentAsset: AnnotationStageAsset | null;
  currentIndex: number;
  checkedAssetIds: readonly string[];
  channels: readonly AnnotationCoverageLane[];
  operation: AnnotationOperationSummary | null;
  activeWorkcell: AnnotationWorkcellId | null;
  overview: AnnotationStageOverviewContent;
  editWorkcell: AnnotationEditWorkcellContent;
  productionWorkcell: AnnotationProductionWorkcellContent;
  dossierWorkcell: AnnotationDossierWorkcellContent;
  confirmation: AnnotationConfirmation | null;
  message: string | null;
  selectAsset(assetId: string): void;
  stepAsset(offset: number): void;
  toggleAssetChecked(assetId: string): void;
  selectDossierSection(section: AnnotationDossierSectionId): void;
  openWorkcell(workcell: AnnotationWorkcellId): void;
  closeWorkcell(): void;
  selectEditChannel(channel: AnnotationEditChannelId): void;
  resolveConfirmation(accepted: boolean): void;
  returnToSpace(): void;
  openArchive(): void;
}

export const QUALITY_FILTER_IDS = [
  "needs_review",
  "unreviewed",
  "stale",
  "invalid",
  "failed",
  "missing",
  "all",
] as const;

export type QualityFilterId = (typeof QUALITY_FILTER_IDS)[number];

export type QualityAsset = AnnotationStageAsset;

export interface QualityQueuePresentation {
  code: string;
  label: string;
  description: string;
  tone: "focus" | "attention" | "danger" | "neutral";
}

export const QUALITY_QUEUE_PRESENTATION: Readonly<
  Record<QualityFilterId, QualityQueuePresentation>
> = {
  needs_review: {
    code: "REVIEW",
    label: "待判定",
    description: "存在尚未复核的当前版本",
    tone: "focus",
  },
  unreviewed: {
    code: "OPEN",
    label: "未复核",
    description: "当前标注仍处于开放状态",
    tone: "attention",
  },
  stale: {
    code: "STALE",
    label: "来源过期",
    description: "图片或源标注已经变化",
    tone: "attention",
  },
  invalid: {
    code: "INVALID",
    label: "校验异常",
    description: "至少一条证据未通过校验",
    tone: "danger",
  },
  failed: {
    code: "FAILED",
    label: "任务失败",
    description: "生成任务留下失败记录",
    tone: "danger",
  },
  missing: {
    code: "MISSING",
    label: "缺少标注",
    description: "对象尚未形成完整证据",
    tone: "neutral",
  },
  all: {
    code: "ALL",
    label: "全部对象",
    description: "查看项目中的完整素材序列",
    tone: "neutral",
  },
};

export const QUALITY_CHANNEL_PRESENTATION: Readonly<
  Record<AnnotationLaneId, { code: string; label: string; description: string }>
> = {
  tags: { code: "TAG.01", label: "标签证据", description: "类别、置信度与词项结构" },
  description: { code: "DSC.02", label: "描述证据", description: "自然语言内容与版本来源" },
  translation: { code: "TRN.03", label: "译文证据", description: "语言身份、源版本与对齐关系" },
};

export interface QualityQueueSummary extends QualityQueuePresentation {
  id: QualityFilterId;
  count: number;
}

export interface QualitySpaceContent {
  kind: "quality";
  status: "no-context" | "loading" | "ready" | "error";
  project: AnnotationProjectContext | null;
  focusAsset: QualityAsset | null;
  focusIndex: number;
  samples: readonly QualityAsset[];
  totalCount: number;
  loadedCount: number;
  fetchingMore: boolean;
  hasMore: boolean;
  filter: QualityFilterId;
  channel: AnnotationLaneId;
  queues: readonly QualityQueueSummary[];
  channels: readonly AnnotationCoverageLane[];
  translationVariants: readonly AnnotationTranslationVariant[];
  checkedCount: number;
  statusCounts: Readonly<Record<string, number>>;
  message: string | null;
  selectAsset(assetId: string): void;
  selectFilter(filter: QualityFilterId): void;
  selectChannel(channel: AnnotationLaneId): void;
  loadMore(): void;
  openReview(assetId?: string, channel?: AnnotationLaneId): void;
  openAnnotation(assetId?: string, channel?: AnnotationLaneId): void;
  openArchive(): void;
  openDelivery(): void;
}

export interface QualityReviewTag {
  name: string;
  category: string | null;
  confidence: number | null;
}

export interface QualityReviewDocument {
  id: string;
  channel: AnnotationLaneId;
  displayName: string;
  contentKind: "text" | "tags";
  content: string;
  tags: readonly QualityReviewTag[];
  availabilityStatus: string;
  reviewStatus: string | null;
  validationStatus: string | null;
  validationIssues: readonly string[];
  sourceLabel: string;
  sourceDetail: string | null;
  headRevisionId: string | null;
  reviewedRevisionId: string | null;
  updatedAt: string | null;
  language: string | null;
  translationSourceKind: string | null;
  translationProducerKind: string | null;
  canReview: boolean;
}

export interface QualityReviewSequence {
  assets: readonly QualityAsset[];
  totalCount: number;
  loadedCount: number;
  fetchingMore: boolean;
  hasMore: boolean;
  loadError: string | null;
  loadMore(): void;
}

export interface QualityReviewContent {
  kind: "quality-review";
  status: "no-context" | "loading" | "ready" | "error";
  project: AnnotationProjectContext | null;
  sequence: QualityReviewSequence;
  currentAsset: QualityAsset | null;
  currentIndex: number;
  filter: QualityFilterId;
  channel: AnnotationLaneId;
  queues: readonly QualityQueueSummary[];
  documents: readonly QualityReviewDocument[];
  activeDocument: QualityReviewDocument | null;
  reviewPending: boolean;
  actionMessage: string | null;
  message: string | null;
  selectAsset(assetId: string): void;
  stepAsset(offset: number): void;
  selectChannel(channel: AnnotationLaneId): void;
  loadMore(): void;
  reviewCurrent(): Promise<void>;
  returnToQuality(): void;
  openAnnotation(): void;
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
  | QualitySpaceContent
  | QualityReviewContent
  | PreparationSpaceContent
  | PreparationWorkbenchContent
  | PendingSpaceContent;

export interface SpacePageFrame {
  space: HomeSpace;
  content: SpacePageContent;
}
