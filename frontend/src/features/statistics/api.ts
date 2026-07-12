import { apiRequest } from "../../shared/api/client";
import type { AnnotationStatistics } from "../../shared/api/types";

export function getTagFrequency(projectId: string): Promise<AnnotationStatistics> {
  return apiRequest(`/api/v1/workspaces/${projectId}/statistics/tag-frequency`);
}
