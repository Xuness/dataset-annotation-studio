import type { ApiOutput, ApiSchema } from "../schema";
import type { AnnotationStatus } from "./annotations";

export type AssetFilterStatus =
  AnnotationStatus | "failed" | "needs_review" | "unreviewed" | "stale";

export type AssetSummary = ApiOutput<"AssetSummary">;
export type AssetListResponse = ApiOutput<"AssetListResponse">;
export type AssetIdListResponse = ApiOutput<"AssetIdListResponse">;
export type AssetFolderSummary = ApiOutput<"AssetFolderSummary">;
export type AssetFolderListResponse = ApiOutput<"AssetFolderListResponse">;
export type AssetFolderSelectionRequest = ApiSchema<"AssetFolderSelectionRequest">;
export type CandidateScope = ApiSchema<"CandidateScope">;
export type CandidateSetSummary = ApiOutput<"CandidateSetSummary">;
export type CandidateUpdateRequest = ApiSchema<"CandidateUpdateRequest">;
export type MetadataDocument = ApiOutput<"MetadataDocument">;
export type PromptPreview = ApiOutput<"RequestPromptPreview">;
export type AnnotationTraceRequestParameters = ApiOutput<"TraceRequestParameters">;
export type AnnotationTraceRequest = ApiOutput<"TraceRequest">;
export type AnnotationTraceResponse = ApiOutput<"TraceResponse">;
export type AssetAnnotationTrace = ApiOutput<"AssetAnnotationTrace">;
