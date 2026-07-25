import { apiRequest } from "../../shared/api/client";
import type {
  TranslationDocument,
  TranslationProducerKind,
  TranslationSourceKind,
} from "../../shared/api/types";

const translationsPath = (projectId: string, assetId: string) =>
  `/api/v1/workspaces/${projectId}/assets/${assetId}/translations`;

export function listTranslations(
  projectId: string,
  assetId: string,
): Promise<TranslationDocument[]> {
  return apiRequest(translationsPath(projectId, assetId));
}

export function getTranslation(
  projectId: string,
  assetId: string,
  language: string,
  sourceKind: TranslationSourceKind = "description",
  producerKind: TranslationProducerKind = "llm",
): Promise<TranslationDocument> {
  const query = new URLSearchParams({
    source_kind: sourceKind,
    producer_kind: producerKind,
  });
  return apiRequest(
    `${translationsPath(projectId, assetId)}/${encodeURIComponent(language)}?${query}`,
  );
}

export function refreshLocalDictionaryTranslation(
  projectId: string,
  assetId: string,
  language: string,
  input: {
    expectedSourceRevisionId: string;
    expectedTranslationRevisionId: string | null;
  },
): Promise<TranslationDocument> {
  return apiRequest(
    `${translationsPath(projectId, assetId)}/${encodeURIComponent(language)}/local-dictionary/refresh`,
    {
      method: "POST",
      body: JSON.stringify({
        expected_source_revision_id: input.expectedSourceRevisionId,
        expected_translation_revision_id: input.expectedTranslationRevisionId,
      }),
    },
  );
}
