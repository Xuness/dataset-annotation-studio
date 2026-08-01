import type { ApiOutput, ApiSchema } from "../schema";

export type TranslationStatus = ApiSchema<"TranslationStatus">;
export type TranslationAlignmentStatus = ApiSchema<"TranslationAlignmentStatus">;
export type TranslationAlignmentPart = ApiOutput<"TranslationAlignmentPart">;
export type TranslationDictionarySource = ApiOutput<"TranslationDictionarySource">;
export type TranslationDocument = ApiOutput<"TranslationDocument">;
