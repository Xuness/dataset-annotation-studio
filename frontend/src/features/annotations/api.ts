import { apiRequest } from "../../shared/api/client";
import type { AnnotationDocument, AnnotationRevision } from "../../shared/api/types";

const annotationPath = (projectId: string, assetId: string) =>
  `/api/v1/workspaces/${projectId}/assets/${assetId}/annotation`;

export function getAnnotation(projectId: string, assetId: string): Promise<AnnotationDocument> {
  return apiRequest(annotationPath(projectId, assetId));
}

export function saveAnnotation(
  projectId: string,
  assetId: string,
  content: string,
): Promise<AnnotationDocument> {
  return apiRequest(annotationPath(projectId, assetId), {
    method: "PUT",
    body: JSON.stringify({ content }),
  });
}

export function deleteAnnotation(projectId: string, assetId: string): Promise<AnnotationDocument> {
  return apiRequest(annotationPath(projectId, assetId), { method: "DELETE" });
}

export function getAnnotationHistory(
  projectId: string,
  assetId: string,
): Promise<AnnotationRevision[]> {
  return apiRequest(`${annotationPath(projectId, assetId)}/history`);
}
