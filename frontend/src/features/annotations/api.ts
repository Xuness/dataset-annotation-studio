import { apiRequest } from "../../shared/api/client";
import type {
  AnnotationBatchDeleteResult,
  AnnotationDocument,
  AnnotationRevision,
} from "../../shared/api/types";

const annotationPath = (projectId: string, assetId: string) =>
  `/api/v1/workspaces/${projectId}/assets/${assetId}/annotation`;

export function getAnnotation(projectId: string, assetId: string): Promise<AnnotationDocument> {
  return apiRequest(annotationPath(projectId, assetId));
}

export function saveAnnotation(
  projectId: string,
  assetId: string,
  content: string,
  expectedModifiedAt: string | null,
): Promise<AnnotationDocument> {
  return apiRequest(annotationPath(projectId, assetId), {
    method: "PUT",
    body: JSON.stringify({ content, expected_modified_at: expectedModifiedAt }),
  });
}

export function deleteAnnotation(projectId: string, assetId: string): Promise<AnnotationDocument> {
  return apiRequest(annotationPath(projectId, assetId), { method: "DELETE" });
}

export function deleteAnnotations(
  projectId: string,
  assetIds: string[],
): Promise<AnnotationBatchDeleteResult> {
  return apiRequest(`/api/v1/workspaces/${projectId}/annotations/delete`, {
    method: "POST",
    body: JSON.stringify({ asset_ids: assetIds }),
  });
}

export function getAnnotationHistory(
  projectId: string,
  assetId: string,
): Promise<AnnotationRevision[]> {
  return apiRequest(`${annotationPath(projectId, assetId)}/history`);
}
