import type { ApiOutput, ApiSchema } from "../schema";

export type CharacterAudit = ApiOutput<"AuditOperation">;
export type CharacterAuditSummary = ApiOutput<"AuditSummary">;
export type CharacterAuditRequest = ApiSchema<"AuditCreateRequest">;
export type CharacterAuditProfile = ApiSchema<"CharacterProfile">;
export type CharacterAuditDecision = ApiSchema<"TagDecision">;
export type CharacterAuditResolution = ApiSchema<"ConflictResolution">;
export type CharacterAuditPreview = ApiOutput<"ApplyPreview">;
export type CharacterAuditMembership = ApiOutput<"MembershipPreview">;
export type CharacterVocabularyLibrary = ApiOutput<"VocabularyLibrary">;
export type CharacterVocabulary = ApiOutput<"VocabularyManifest">;
