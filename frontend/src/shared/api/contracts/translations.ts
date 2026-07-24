export type TranslationStatus =
  "missing" | "current" | "stale" | "source_missing" | "source_invalid";

export interface TranslationDocument {
  asset_id: string;
  language: string;
  path: string;
  exists: boolean;
  content: string;
  status: TranslationStatus;
  source_exists: boolean;
  source_hash: string | null;
  current_source_hash: string | null;
  validation_status: string | null;
  provider_profile_id: string | null;
  provider_profile_name: string | null;
  model: string | null;
  modified_at: string | null;
  updated_at: string | null;
  issue: string | null;
}
