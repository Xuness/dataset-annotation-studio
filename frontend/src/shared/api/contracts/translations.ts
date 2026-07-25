import type { AnnotationTag, TranslationProducerKind, TranslationSourceKind } from "./annotations";

export type TranslationStatus =
  "missing" | "current" | "source_mismatch" | "invalid" | "source_missing" | "source_invalid";

export type TranslationAlignmentStatus = "aligned" | "unavailable" | "invalid";

export interface TranslationAlignmentPart {
  id: string;
  kind: "segment" | "structure" | "tag";
  source_text: string;
  translated_text: string;
  category: string | null;
  confidence: number | null;
}

export interface TranslationDictionarySource {
  installation_id: string;
  name: string;
  adapter_id: string | null;
  source_version: string | null;
  matched_count: number;
}

export interface TranslationDocument {
  asset_id: string;
  language: string;
  source_kind: TranslationSourceKind;
  producer_kind: TranslationProducerKind;
  resolved_source_channel: string | null;
  path: string;
  exists: boolean;
  content: string;
  source_content: string;
  source_tags: AnnotationTag[];
  status: TranslationStatus;
  source_exists: boolean;
  source_hash: string | null;
  current_source_hash: string | null;
  source_revision_id: string | null;
  alignment_status: TranslationAlignmentStatus;
  alignment_parts: TranslationAlignmentPart[];
  validation_status: string | null;
  provider_profile_id: string | null;
  provider_profile_name: string | null;
  model: string | null;
  translation_protocol_version: number | null;
  quality_status: "unavailable" | "passed" | "warning";
  quality_issues: string[];
  dictionary_resolution_hash: string | null;
  current_dictionary_resolution_hash: string | null;
  dictionary_sources: TranslationDictionarySource[];
  dictionary_override_count: number;
  dictionary_unmatched_count: number;
  modified_at: string | null;
  updated_at: string | null;
  issue: string | null;
}
