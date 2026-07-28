import type {
  AnnotationChannel,
  TranslationProducerKind,
  TranslationSourceKind,
} from "./annotations";

export type ExportScope = "all" | "selected";
export type ExportRevisionMode = "current" | "reviewed";
export type ExportFormat = "txt" | "json";
export type ExportPackaging = "directory" | "zip";

export interface ExportChannelSelection {
  channel: AnnotationChannel;
  language: string;
  translation_source_kind?: TranslationSourceKind | null;
  translation_producer_kind?: TranslationProducerKind | null;
  revision: ExportRevisionMode;
}

export interface ExportRequest {
  scope: ExportScope;
  asset_ids: string[];
  destination_path: string;
  channels: ExportChannelSelection[];
  formats: ExportFormat[];
  packaging: ExportPackaging;
}

export interface ExportPreviewItem {
  asset_id: string;
  source_relative_path: string;
  target_image_name: string;
  target_annotation_name: string;
  target_outputs: string[];
  channel_statuses: Record<string, string>;
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
  usable_count: number;
  reviewed_count: number;
  missing_count: number;
  empty_count: number;
  invalid_count: number;
  encoding_error_count: number;
  unreviewed_count: number;
  stale_count: number;
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
  configuration_snapshot: {
    channels?: ExportChannelSelection[];
    formats?: ExportFormat[];
    packaging?: ExportPackaging;
  };
  current_relative_path: string | null;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  completed_at: string | null;
  error_message: string | null;
}
