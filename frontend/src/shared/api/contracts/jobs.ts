import type { ApiOutput, ApiSchema } from "../schema";

export type JobStatus = ApiSchema<"JobStatus">;
export type JobItemStatus = ApiSchema<"JobItemStatus">;
export type JobKind = ApiSchema<"JobKind">;
export type ExecutionBackend = ApiSchema<"ExecutionBackend">;
export type ExistingTranslationPolicy = ApiSchema<"ExistingTranslationPolicy">;
export type JobSummary = ApiOutput<"JobSummary">;
export type JobAttempt = ApiOutput<"JobAttempt">;
export type JobItemDetail = ApiOutput<"JobItemDetail">;
export type JobDetail = ApiOutput<"JobDetail">;
export type AssetRelatedJob = ApiOutput<"AssetRelatedJob">;
