export type AssetDeleteStatus =
  "running" | "completed" | "undoing" | "undone" | "failed" | "recovering" | "recovery_required";

export interface AssetDeletionPreview {
  asset_count: number;
  file_count: number;
  image_count: number;
  annotation_count: number;
  translation_count: number;
  metadata_count: number;
  shared_sidecar_count: number;
  warnings: string[];
  blocking_issues: string[];
  preview_token: string;
}

export interface AssetDeleteOperation {
  id: string;
  status: AssetDeleteStatus;
  asset_count: number;
  file_count: number;
  image_count: number;
  annotation_count: number;
  translation_count: number;
  metadata_count: number;
  shared_sidecar_count: number;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  undone_at: string | null;
  error_message: string | null;
}
