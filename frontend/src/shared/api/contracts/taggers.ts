export type TaggerInstallationStatus = "ready" | "invalid" | "missing";
export type TaggerDevice = "auto" | "cpu" | "cuda" | "directml";

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
  model_version: string;
  relative_path: string;
  path: string;
  fingerprint: string;
  status: TaggerInstallationStatus;
  issues: string[];
  tag_count: number;
  categories: Record<string, number>;
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
  threshold: number;
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
  threshold: number;
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
  supported_adapters: Array<{ id: string; name: string; description: string }>;
  scan_issues: string[];
}
