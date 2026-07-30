export type TokenizationProfileId = "krea2" | "anima" | "t5";

export interface TokenizationMetricDescriptor {
  id: string;
  label: string;
  short_label: string;
}

export interface TokenizationProfile {
  id: TokenizationProfileId;
  name: string;
  description: string;
  metrics: TokenizationMetricDescriptor[];
}

export interface TokenCountRequestItem {
  id: string;
  text: string;
}

export interface TokenCountRequest {
  profile_id: TokenizationProfileId;
  items: TokenCountRequestItem[];
}

export interface TokenMetricCount {
  metric_id: string;
  count: number;
}

export interface TokenCountResult {
  id: string;
  metrics: TokenMetricCount[];
}

export interface TokenCountResponse {
  profile: TokenizationProfile;
  items: TokenCountResult[];
}
