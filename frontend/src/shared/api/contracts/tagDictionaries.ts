export type TagDictionaryInstallationStatus = "ready" | "missing" | "invalid";
export type TagDictionaryLicenseStatus = "verified" | "mixed" | "undeclared";
export type TagDictionaryDownloadMode = "direct" | "manual";
export type TagDictionaryDownloadStatus =
  | "queued"
  | "downloading"
  | "verifying"
  | "installing"
  | "completed"
  | "paused"
  | "failed"
  | "interrupted";

export interface TagDictionaryAdapterSummary {
  id: string;
  name: string;
  description: string;
  accepted_inputs: string[];
}

export interface TagDictionaryInstallation {
  id: string;
  name: string;
  adapter_id: string;
  source_id: string;
  source_version: string;
  language: string;
  path: string;
  fingerprint: string;
  entry_count: number;
  disk_size: number;
  enabled: boolean;
  priority: number;
  status: TagDictionaryInstallationStatus;
  issue: string | null;
  source_url: string;
  license_id: string;
  license_url: string;
  license_status: TagDictionaryLicenseStatus;
  created_at: string;
  updated_at: string;
}

export interface TagDictionaryLibrary {
  dictionary_root: string;
  disk_size: number;
  entry_count: number;
  override_count: number;
  installations: TagDictionaryInstallation[];
  supported_adapters: TagDictionaryAdapterSummary[];
  scan_issues: string[];
}

export interface TagDictionaryOverride {
  tag: string;
  normalized_tag: string;
  translation: string;
  language: string;
  category: string | null;
  revision: number;
  created_at: string;
  updated_at: string;
}

export interface TagDictionarySearchItem {
  tag: string;
  normalized_tag: string;
  effective_translation: string | null;
  source_kind: "override" | "dictionary" | "fallback";
  source_name: string | null;
  installation_id: string | null;
  adapter_id: string | null;
  category: string | null;
  post_count: number | null;
  override: TagDictionaryOverride | null;
}

export interface TagDictionarySearchResult {
  query: string;
  language: string;
  items: TagDictionarySearchItem[];
  total: number;
  offset: number;
  limit: number;
}

export interface TagDictionaryResolvedEntry {
  requested_tag: string;
  normalized_tag: string;
  translation: string | null;
  matched: boolean;
  source_kind: "override" | "dictionary" | "fallback";
  installation_id: string | null;
  installation_name: string | null;
  adapter_id: string | null;
  source_version: string | null;
  category: string | null;
  post_count: number | null;
  override_revision: number | null;
}

export interface TagDictionaryResolution {
  language: string;
  entries: TagDictionaryResolvedEntry[];
  resolution_hash: string;
  unmatched_count: number;
}

export interface TagDictionaryDownloadOffer {
  offer_id: string;
  adapter_id: string;
  name: string;
  description: string;
  source_id: string;
  source_url: string;
  source_version: string;
  revision: string | null;
  download_mode: TagDictionaryDownloadMode;
  download_url: string | null;
  filename: string | null;
  download_size: number | null;
  sha256: string | null;
  license_id: string;
  license_url: string;
  license_status: TagDictionaryLicenseStatus;
  license_notice: string;
  installed_installation_id: string | null;
  active_download_id: string | null;
}

export interface TagDictionaryDownloadTask {
  id: string;
  offer_id: string;
  offer_name: string;
  adapter_id: string;
  source_id: string;
  source_version: string;
  revision: string | null;
  dictionary_root: string;
  status: TagDictionaryDownloadStatus;
  bytes_total: number;
  bytes_downloaded: number;
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

export interface TagDictionaryDownloadCenter {
  offers: TagDictionaryDownloadOffer[];
  tasks: TagDictionaryDownloadTask[];
}
