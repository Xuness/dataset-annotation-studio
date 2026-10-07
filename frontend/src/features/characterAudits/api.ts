import { validateCharacterAuditRequest } from "./validation";
import { apiRequest } from "../../shared/api/client";
import type {
  CharacterAudit,
  CharacterAuditSummary,
  CharacterAuditRequest,
  CharacterAuditDecision,
  CharacterAuditResolution,
  CharacterAuditPreview,
  CharacterAuditMembership,
  CharacterVocabularyLibrary,
  CharacterVocabulary,
} from "../../shared/api/contracts/characterAudits";

function base(projectId: string): string {
  return `/api/v1/workspaces/${encodeURIComponent(projectId)}/character-audits`;
}
function task(projectId: string, operationId: string): string {
  return `${base(projectId)}/${encodeURIComponent(operationId)}`;
}
export function listCharacterAudits(projectId: string): Promise<CharacterAuditSummary[]> {
  return apiRequest(base(projectId));
}
export function getCharacterAudit(projectId: string, operationId: string): Promise<CharacterAudit> {
  return apiRequest(task(projectId, operationId));
}
export function createCharacterAudit(
  projectId: string,
  request: CharacterAuditRequest,
): Promise<CharacterAudit> {
  validateCharacterAuditRequest(request);
  return apiRequest(base(projectId), { method: "POST", body: JSON.stringify(request) });
}
export function previewCharacterMembership(
  projectId: string,
  request: CharacterAuditRequest,
): Promise<CharacterAuditMembership> {
  validateCharacterAuditRequest(request);
  return apiRequest(`${base(projectId)}/membership-preview`, {
    method: "POST",
    body: JSON.stringify(request),
  });
}
export function startCharacterAudit(
  projectId: string,
  operationId: string,
  version: number,
): Promise<CharacterAudit> {
  return apiRequest(`${task(projectId, operationId)}/start`, {
    method: "POST",
    body: JSON.stringify({ version }),
  });
}
export function stopCharacterAudit(
  projectId: string,
  operationId: string,
): Promise<CharacterAudit> {
  return apiRequest(`${task(projectId, operationId)}/stop`, { method: "POST" });
}
export function prepareCharacterTags(
  projectId: string,
  operationId: string,
  version: number,
  taggerProfileId: string,
  overwriteExisting: boolean,
): Promise<CharacterAudit> {
  return apiRequest(`${task(projectId, operationId)}/prepare-tags`, {
    method: "POST",
    body: JSON.stringify({
      version,
      tagger_profile_id: taggerProfileId,
      overwrite_existing: overwriteExisting,
    }),
  });
}
export function saveCharacterReview(
  projectId: string,
  operationId: string,
  index: number,
  version: number,
  decisions: readonly CharacterAuditDecision[],
): Promise<CharacterAudit> {
  return apiRequest(`${task(projectId, operationId)}/profiles/${index}`, {
    method: "PUT",
    body: JSON.stringify({ version, decisions }),
  });
}
export function redoCharacterVisual(
  projectId: string,
  operationId: string,
  index: number,
  version: number,
): Promise<CharacterAudit> {
  return apiRequest(`${task(projectId, operationId)}/profiles/${index}/redo-visual`, {
    method: "POST",
    body: JSON.stringify({ version }),
  });
}
export function saveCharacterResolutions(
  projectId: string,
  operationId: string,
  version: number,
  resolutions: readonly CharacterAuditResolution[],
): Promise<CharacterAudit> {
  return apiRequest(`${task(projectId, operationId)}/resolutions`, {
    method: "PUT",
    body: JSON.stringify({ version, resolutions }),
  });
}
export function previewCharacterAudit(
  projectId: string,
  operationId: string,
): Promise<CharacterAuditPreview> {
  return apiRequest(`${task(projectId, operationId)}/preview`, { method: "POST" });
}
export function applyCharacterAudit(
  projectId: string,
  operationId: string,
  previewToken: string,
): Promise<CharacterAudit> {
  return apiRequest(`${task(projectId, operationId)}/apply`, {
    method: "POST",
    body: JSON.stringify({ preview_token: previewToken }),
  });
}
export function listCharacterVocabularies(): Promise<CharacterVocabularyLibrary> {
  return apiRequest("/api/v1/character-audit-vocabularies");
}
export function importCharacterVocabulary(
  directory: string,
  sourceVersion: string,
): Promise<CharacterVocabulary> {
  return apiRequest("/api/v1/character-audit-vocabularies", {
    method: "POST",
    body: JSON.stringify({ directory, source_version: sourceVersion, license_acknowledged: true }),
  });
}
