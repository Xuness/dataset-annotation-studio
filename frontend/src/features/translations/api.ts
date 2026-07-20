import { apiRequest } from "../../shared/api/client";
import type { TranslationDocument } from "../../shared/api/types";

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
): Promise<TranslationDocument> {
  return apiRequest(`${translationsPath(projectId, assetId)}/${encodeURIComponent(language)}`);
}
