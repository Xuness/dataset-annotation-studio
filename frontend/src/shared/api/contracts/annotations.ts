export type AnnotationStatus =
  "missing" | "valid" | "invalid" | "encoding_error" | "empty" | "unchecked" | "manually_accepted";

export type AnnotationChannel = "existing_annotation" | "tags" | "description" | "translation";
export type AnnotationContentKind = "text" | "tags";
export type AnnotationReviewStatus = "missing" | "unreviewed" | "confirmed" | "stale";

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

export interface AnnotationDocument {
  asset_id: string;
  document_id: string | null;
  channel: AnnotationChannel;
  language: string | null;
  display_name: string;
  content_kind: AnnotationContentKind;
  path: string;
  exists: boolean;
  content: string;
  tags: AnnotationTag[];
  status: AnnotationStatus;
  review_status: AnnotationReviewStatus;
  validation: ValidationResult | null;
  validation_status: AnnotationStatus | null;
  modified_at: string | null;
  head_revision_id: string | null;
  confirmed_revision_id: string | null;
  image_content_hash: string | null;
  current_image_hash: string | null;
  source: string | null;
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

export interface AnnotationBatchDeleteResult {
  requested_count: number;
  deleted_count: number;
  missing_count: number;
  asset_ids: string[];
}
