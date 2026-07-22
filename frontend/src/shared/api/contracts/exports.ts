export type ExportScope = "all" | "selected";

export interface ExportRequest {
  scope: ExportScope;
  asset_ids: string[];
  destination_path: string;
}

export interface ExportPreviewItem {
  asset_id: string;
  source_relative_path: string;
  target_image_name: string;
  target_annotation_name: string;
  annotation_status: string;
  image_bytes: number;
  annotation_bytes: number;
  warning_code: string | null;
  warning_message: string | null;
  blocking_issue: string | null;
}

export interface ExportPreview {
  items: ExportPreviewItem[];
  total_items: number;
  truncated: boolean;
  image_bytes: number;
  annotation_bytes: number;
  valid_count: number;
  manually_accepted_count: number;
  missing_count: number;
  empty_count: number;
  invalid_count: number;
  encoding_error_count: number;
  warning_count: number;
  blocking_issue_count: number;
  blocking_issues: string[];
  preview_token: string;
}

export type ExportOperationStatus =
  "queued" | "running" | "stopping" | "stopped" | "interrupted" | "completed" | "failed";

export interface ExportOperation {
  id: string;
  status: ExportOperationStatus;
  scope: ExportScope;
  destination_path: string;
  total_items: number;
  completed_items: number;
  total_bytes: number;
  copied_bytes: number;
  warning_count: number;
  allow_warnings: boolean;
  current_relative_path: string | null;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  completed_at: string | null;
  error_message: string | null;
}
