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
    source_type: "local_import" | "local_scan";
    original_path: string | null;
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
