export type AnnotationStatus =
  "missing" | "valid" | "invalid" | "encoding_error" | "empty" | "unchecked" | "manually_accepted";

export type AnnotationChannel = "existing_annotation" | "tags" | "description" | "translation";
export type TranslationSourceKind = "description" | "tags";
export type TranslationProducerKind = "llm" | "local_dictionary";
export type AnnotationContentKind = "text" | "tags";
export type AnnotationAvailabilityStatus = "missing" | "usable" | "invalid" | "stale";
export type AnnotationReviewStatus = "unreviewed" | "reviewed";

export interface ValidationIssue {
  code: string;
  message: string;
  offset: number | null;
  tag: string | null;
}

export interface ValidationResult {
  valid: boolean;
  status: AnnotationStatus;
  tag_count: number;
  issues: ValidationIssue[];
}

export interface AnnotationTag {
  name: string;
  category: string | null;
  confidence: number | null;
  origin: string;
}

export interface AnnotationTaggerSource {
  installation_id: string;
  installation_name: string;
  adapter_id: string;
  model_version: string;
  fingerprint: string;
}

export interface AnnotationDocument {
  asset_id: string;
  document_id: string | null;
  channel: AnnotationChannel;
  language: string | null;
  translation_source_kind: TranslationSourceKind | null;
  translation_producer_kind: TranslationProducerKind | null;
  display_name: string;
  content_kind: AnnotationContentKind;
  path: string;
  exists: boolean;
  content: string;
  tags: AnnotationTag[];
  status: AnnotationStatus;
  availability_status: AnnotationAvailabilityStatus;
  review_status: AnnotationReviewStatus | null;
  validation: ValidationResult | null;
  validation_status: AnnotationStatus | null;
  modified_at: string | null;
  head_revision_id: string | null;
  reviewed_revision_id: string | null;
  image_content_hash: string | null;
  current_image_hash: string | null;
  source: string | null;
  tagger_source: AnnotationTaggerSource | null;
  updated_at: string | null;
}

export interface AnnotationBundle {
  asset_id: string;
  documents: AnnotationDocument[];
}

export interface AnnotationRevision {
  id: string;
  document_id: string | null;
  channel: AnnotationChannel | null;
  language: string | null;
  translation_source_kind: TranslationSourceKind | null;
  translation_producer_kind: TranslationProducerKind | null;
  source: string;
  validation_status: AnnotationStatus;
  created_at: string;
  content: string;
  tags: AnnotationTag[];
  is_tombstone: boolean;
  is_candidate: boolean;
  image_content_hash: string | null;
  source_job_item_id: string | null;
}

export interface AnnotationChannelTarget {
  channel: AnnotationChannel;
  language: string;
  translation_source_kind?: TranslationSourceKind | null;
  translation_producer_kind?: TranslationProducerKind | null;
}

export interface AnnotationBatchTargetOption {
  channel: AnnotationChannel;
  language: string | null;
  translation_source_kind: TranslationSourceKind | null;
  translation_producer_kind: TranslationProducerKind | null;
  display_name: string;
  active_count: number;
  reviewable_count: number;
  reviewed_count: number;
  stale_count: number;
  blocked_count: number;
}

export interface AnnotationBatchOptions {
  requested_count: number;
  targets: AnnotationBatchTargetOption[];
}

export interface AnnotationBatchDeleteResult {
  requested_count: number;
  target_count: number;
  deleted_count: number;
  missing_count: number;
  asset_ids: string[];
}

export interface AnnotationBatchReviewResult {
  requested_count: number;
  target_count: number;
  reviewed_count: number;
  already_reviewed_count: number;
  missing_count: number;
  blocked_count: number;
  asset_ids: string[];
}
