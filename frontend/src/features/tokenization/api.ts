import { apiRequest } from "../../shared/api/client";
import type {
  TokenCountRequest,
  TokenCountResponse,
  TokenizationProfile,
} from "../../shared/api/types";

export function getTokenizationProfiles(signal?: AbortSignal): Promise<TokenizationProfile[]> {
  return apiRequest("/api/v1/tokenization/profiles", { signal });
}

export function countTokens(
  request: TokenCountRequest,
  signal?: AbortSignal,
): Promise<TokenCountResponse> {
  return apiRequest("/api/v1/tokenization/count", {
    method: "POST",
    body: JSON.stringify(request),
    signal,
  });
}
