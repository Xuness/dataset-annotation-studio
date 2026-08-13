export type ScreeningProfile = "character_lora";
export type ScreeningStrength = "conservative" | "balanced" | "aggressive";
export type ScreeningOperationStatus =
  "queued" | "running" | "stopping" | "stopped" | "interrupted" | "completed" | "failed";
export type ScreeningPool =
  | "invalid"
  | "quarantine"
  | "low_evidence_protected"
  | "elite_candidate"
  | "recommended"
  | "review"
  | "low_priority_high_confidence";
export type ScreeningRating = "g" | "s" | "q" | "e";
export type ScreeningSort = "priority" | "percentile" | "score" | "path";
export type ScreeningFlag = "low_resolution" | "duplicate_variant";

export interface ScreeningCapabilities {
  score_mode: "batch_only_v0_1";
  score_version: string;
  max_assets_per_operation: number;
  task_profiles: ScreeningProfile[];
  intensities: ScreeningStrength[];
  candidate_pools: ScreeningPool[];
  batch_local_only: boolean;
  reads_global_archive: boolean;
  modifies_assets: boolean;
  enabled_signals: string[];
  disabled_signals: string[];
}

export interface CreateScreeningOperationRequest {
  asset_ids: string[];
  task_profile: ScreeningProfile;
  intensity: ScreeningStrength;
  metadata_snapshot_at: string | null;
}

export interface ScreeningOperation {
  id: string;
  status: ScreeningOperationStatus;
  score_mode: string;
  score_version: string;
  total_items: number;
  processed_items: number;
  scored_items: number;
  invalid_items: number;
  current_relative_path: string | null;
  configuration_snapshot: Record<string, unknown>;
  pool_counts: Partial<Record<ScreeningPool, number>>;
  rating_counts: Partial<Record<ScreeningRating, number>>;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  completed_at: string | null;
  error_message: string | null;
  low_resolution_count?: number;
  duplicate_variant_count?: number;
}

export interface ScreeningScoreDetails {
  popularity_percentile_raw: number;
  popularity_percentile_final: number;
  depth_percentile_raw: number;
  depth_percentile_final: number;
  vote_posterior_mean: number | null;
  vote_posterior_lower_95: number | null;
  vote_percentile_mean: number | null;
  vote_percentile_lower: number | null;
  vote_keep_signal: number;
  bad_pop: number;
  bad_depth: number;
  bad_vote: number;
  bad_consensus_second: number;
}

export interface ScreeningItem {
  asset_id: string;
  source_relative_path: string;
  image_width: number | null;
  image_height: number | null;
  metadata_relative_path: string | null;
  status: "pending" | "parsed" | "scored" | "invalid";
  rating: ScreeningRating | null;
  created_at: string | null;
  metadata_snapshot_at: string | null;
  age_hours: number | null;
  age_bucket: string | null;
  fav_count: number | null;
  up_score: number | null;
  downvote_count: number | null;
  evidence_mass: number | null;
  confidence_pop: number | null;
  confidence_depth: number | null;
  confidence_vote: number | null;
  technical_score: number | null;
  keep_score: number | null;
  elite_score: number | null;
  final_score: number | null;
  rating_rank: number | null;
  rating_percentile: number | null;
  candidate_pool: ScreeningPool | null;
  low_resolution_flag: boolean;
  pixel_duplicate_group: string | null;
  variant_group: string | null;
  duplicate_representative: boolean;
  duplicate_of_asset_id: string | null;
  score_details: ScreeningScoreDetails | null;
  reason_codes: string[];
  warnings: string[];
  error_code: string | null;
  error_message: string | null;
}

export interface ScreeningItemListResponse {
  items: ScreeningItem[];
  total: number;
  offset: number;
  limit: number;
}

export interface ScreeningAssetIdListResponse {
  ids: string[];
  total: number;
}

export interface ScreeningItemQuery {
  offset?: number;
  limit?: number;
  pool?: ScreeningPool | null;
  rating?: ScreeningRating | null;
  flag?: ScreeningFlag | null;
  sort?: ScreeningSort;
}
