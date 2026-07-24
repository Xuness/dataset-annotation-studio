export interface WorkspaceSettings {
  recursive_scan: boolean;
  system_preset_id: string | null;
  user_prompt: string;
  json_fields: string[];
  use_confirmed_tags: boolean;
  validation_mode: string;
}

export interface WorkspaceSummary {
  project_id: string;
  name: string;
  root_path: string;
  exists: boolean;
  created_at: string;
  last_opened_at: string | null;
  settings: WorkspaceSettings;
  asset_count: number;
  annotated_count: number;
  invalid_count: number;
}

export interface ScanResult {
  scanned_files: number;
  indexed_assets: number;
  added: number;
  updated: number;
  missing: number;
  failed: number;
  issues: Array<{ path: string; message: string }>;
  duration_ms: number;
}

export interface WorkspaceOpenResponse {
  workspace: WorkspaceSummary;
  scan: ScanResult;
}
