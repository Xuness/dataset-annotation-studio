export type TaggerInstallationStatus = "ready" | "invalid" | "missing";
export type TaggerDevice = "auto" | "cpu" | "cuda" | "directml";
export type TaggerSelectionMode = "global" | "category" | "model_recommended";

export interface TaggerSelectionPolicy {
  mode: TaggerSelectionMode;
  global_threshold: number;
  category_thresholds: Record<string, number>;
  max_tags: number | null;
}

export interface TaggerProfileCapabilities {
  supported_selection_modes: TaggerSelectionMode[];
  default_selection: TaggerSelectionPolicy;
  default_categories: string[];
}

export interface TaggerFileRecord {
  relative_path: string;
  size: number;
  modified_ns: number;
  sha256: string;
}

export interface TaggerInstallation {
  id: string;
  name: string;
  adapter_id: string;
  adapter_name: string;
  adapter_contract_version: number;
  model_version: string;
  relative_path: string;
  path: string;
  fingerprint: string;
  status: TaggerInstallationStatus;
  issues: string[];
  warnings: string[];
  tag_count: number;
  categories: Record<string, number>;
  profile_capabilities: TaggerProfileCapabilities;
  files: TaggerFileRecord[];
  source: {
    source_type: "local_import" | "local_scan" | "huggingface";
    original_path: string | null;
    plan_id: string | null;
    repo_id: string | null;
    revision: string | null;
  } | null;
  disk_size: number;
  created_at: string;
  updated_at: string;
}

export interface TaggerProfile {
  id: string;
  name: string;
  installation_id: string;
  selection: TaggerSelectionPolicy;
  categories: string[];
  device: TaggerDevice;
  concurrency: number;
  batch_size: number | null;
  installation_name: string | null;
  model_version: string | null;
  ready: boolean;
  issue: string | null;
  created_at: string;
  updated_at: string;
}

export interface TaggerProfileInput {
  name: string;
  installation_id: string;
  selection: TaggerSelectionPolicy;
  categories: string[];
  device: TaggerDevice;
  batch_size: number | null;
}

export interface TaggerLibrary {
  model_root: string;
  disk_size: number;
  installations: TaggerInstallation[];
  profiles: TaggerProfile[];
  runtime: {
    available: boolean;
    providers: string[];
    devices: TaggerDevice[];
    error: string | null;
  };
  supported_adapters: Array<{
    id: string;
    name: string;
    description: string;
    contract_version: number;
  }>;
  scan_issues: string[];
}

export type TaggerDownloadStatus =
  | "queued"
  | "resolving"
  | "downloading"
  | "verifying"
  | "installing"
  | "completed"
  | "paused"
  | "failed"
  | "interrupted";

export type HuggingFaceProxyMode = "environment" | "custom" | "direct";
export type HuggingFaceTokenSource = "app" | "environment" | "local_login" | "anonymous";

export interface TaggerDownloadOffer {
  plan_id: string;
  adapter_id: string;
  adapter_name: string;
  name: string;
  model_version: string;
  description: string;
  repo_id: string;
  revision: string;
  source_url: string;
  license_id: string;
  license_url: string;
  gated: boolean;
  provenance: "author" | "community";
  download_size: number;
  file_count: number;
  installed_installation_id: string | null;
  installed_installation_name: string | null;
  active_download_id: string | null;
}

export interface TaggerDownloadTask {
  id: string;
  plan_id: string;
  plan_name: string;
  adapter_id: string;
  repo_id: string;
  revision: string;
  model_root: string;
  status: TaggerDownloadStatus;
  bytes_total: number;
  bytes_downloaded: number;
  files_total: number;
  files_completed: number;
  current_file: string | null;
  speed_bps: number | null;
  eta_seconds: number | null;
  stop_requested: boolean;
  installation_id: string | null;
  error_code: string | null;
  error_message: string | null;
  can_pause: boolean;
  can_resume: boolean;
  can_delete: boolean;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  updated_at: string;
}

export interface HuggingFaceConnectionSettings {
  token_source: HuggingFaceTokenSource;
  has_saved_token: boolean;
  proxy_mode: HuggingFaceProxyMode;
  has_custom_proxy: boolean;
  proxy_display: string | null;
  credential_store_available: boolean;
  credential_store_error: string | null;
}

export interface HuggingFaceSettingsUpdate {
  proxy_mode: HuggingFaceProxyMode;
  token?: string;
  clear_token?: boolean;
  proxy_url?: string;
  clear_proxy?: boolean;
}

export interface HuggingFaceConnectionTest {
  connected: boolean;
  username: string | null;
  token_source: HuggingFaceTokenSource;
  proxy_mode: HuggingFaceProxyMode;
  proxy_display: string | null;
  latency_ms: number;
  message: string;
}

export interface TaggerDownloadCenter {
  offers: TaggerDownloadOffer[];
  tasks: TaggerDownloadTask[];
}
