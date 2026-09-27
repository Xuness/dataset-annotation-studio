import type { WorkspaceSummary } from "../../shared/api/types";
import type {
  CharacterAudit,
  CharacterAuditSummary,
  CharacterAuditRequest,
  CharacterAuditProfile,
  CharacterAuditDecision,
  CharacterAuditResolution,
  CharacterAuditPreview,
  CharacterAuditMembership,
  CharacterVocabulary,
} from "../../shared/api/contracts/characterAudits";

export type {
  CharacterAuditDecision,
  CharacterAuditProfile,
  CharacterAuditResolution,
} from "../../shared/api/contracts/characterAudits";

export interface CharacterChoice {
  id: string;
  name: string;
}
export interface CharacterProviderChoice extends CharacterChoice {
  models: readonly string[];
}
export interface CharacterReferenceChoice extends CharacterChoice {
  imageUrl: string;
}

export interface CharacterAuditContent {
  kind: "character-audit";
  workspace: WorkspaceSummary | null;
  projectId: string | null;
  status: "loading" | "ready" | "error";
  busy: boolean;
  message: string | null;
  issues: readonly string[];
  operations: readonly CharacterAuditSummary[];
  operation: CharacterAudit | null;
  form: CharacterAuditRequest;
  checkedCount: number;
  providers: readonly CharacterProviderChoice[];
  taggers: readonly CharacterChoice[];
  vocabularies: readonly CharacterVocabulary[];
  references: readonly CharacterReferenceChoice[];
  referenceSearch: string;
  hasMoreReferences: boolean;
  membership: CharacterAuditMembership | null;
  preview: CharacterAuditPreview | null;
  profileIndex: number;
  decisions: readonly CharacterAuditDecision[];
  dirty: boolean;
  referenceUrl: string | null;
  sourceImages: readonly CharacterReferenceChoice[];
  vocabularyDirectory: string;
  vocabularyVersion: string;
  licenseAcknowledged: boolean;
  taggerProfileId: string;
  overwriteExisting: boolean;
  setForm(form: CharacterAuditRequest): void;
  setVocabularyDirectory(value: string): void;
  setVocabularyVersion(value: string): void;
  setLicenseAcknowledged(value: boolean): void;
  setTaggerProfileId(value: string): void;
  setOverwriteExisting(value: boolean): void;
  searchReferences(value: string): void;
  loadMoreReferences(): void;
  updateProfile(index: number, profile: CharacterAuditProfile): void;
  addProfile(): void;
  removeProfile(index: number): void;
  importVocabulary(): Promise<void>;
  previewMembership(): Promise<void>;
  create(): Promise<void>;
  selectOperation(id: string | null): Promise<void>;
  start(): Promise<void>;
  stop(): Promise<void>;
  prepareTags(): Promise<void>;
  selectProfile(index: number): Promise<void>;
  updateDecision(index: number, decision: CharacterAuditDecision): void;
  useSuggestions(): void;
  saveReview(): Promise<void>;
  redoVisual(): Promise<void>;
  generatePreview(): Promise<void>;
  resolveConflict(resolution: CharacterAuditResolution): Promise<void>;
  apply(): Promise<void>;
  copyPrompt(): Promise<void>;
  openPrerequisite(): Promise<void>;
  returnToAnnotation(): Promise<void>;
}

export function emptyCharacterProfile(): CharacterAuditProfile {
  return {
    trigger: "",
    reference_asset_id: "",
    membership: "trigger",
    directory: null,
    subject: "unknown",
  };
}

export function initialCharacterForm(): CharacterAuditRequest {
  return {
    scope: "all",
    directory: null,
    asset_ids: [],
    profiles: [emptyCharacterProfile()],
    style: "sparse",
    minimum_count: 10,
    provider_profile_id: "",
    model_id: "",
    vocabulary_id: "",
    retry_limit: 2,
  };
}

export const CHARACTER_AUDIT_STATUS: Readonly<Record<CharacterAudit["status"], string>> = {
  draft: "等待准备",
  preparing: "正在补齐标签",
  queued: "等待执行",
  running: "模型审查中",
  stopping: "正在停止",
  stopped: "已停止",
  interrupted: "执行中断",
  failed: "执行失败",
  review: "待人工审阅",
  applied: "已应用",
};

export type CharacterTagConflict = CharacterAuditPreview["conflicts"][number];

export const ACTIVE_CHARACTER_AUDIT_STATUSES: ReadonlySet<string> = new Set([
  "preparing",
  "queued",
  "running",
  "stopping",
]);
export const CHARACTER_APPEARANCE_CATEGORIES: ReadonlySet<string> = new Set([
  "hair",
  "eyes",
  "face",
  "body",
  "clothing",
  "footwear",
  "legwear",
  "accessory",
]);
export const CHARACTER_DECISIONS = ["keep", "delete", "replace", "uncertain"] as const;
export const CHARACTER_DECISION_LABELS: Readonly<
  Record<CharacterAuditDecision["decision"], string>
> = {
  keep: "保留",
  delete: "删除",
  replace: "替换",
  uncertain: "不确定",
};
