export type AnnotationStatus =
  "missing" | "valid" | "invalid" | "encoding_error" | "empty" | "unchecked" | "manually_accepted";

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

export interface AnnotationDocument {
  asset_id: string;
  path: string;
  exists: boolean;
  content: string;
  status: AnnotationStatus;
  validation: ValidationResult | null;
  modified_at: string | null;
}

export interface AnnotationRevision {
  id: string;
  source: string;
  validation_status: AnnotationStatus;
  created_at: string;
  content: string;
}
