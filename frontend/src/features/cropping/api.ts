import { apiAssetUrl, apiRequest } from "../../shared/api/client";
import type {
  BatchCropRequest,
  CropOperation,
  CropPlan,
  CropProvenance,
  RatioPreset,
  RatioPresetInput,
  SingleCropRequest,
} from "../../shared/api/types";

const path = (project: string) => `/api/v1/workspaces/${project}/cropping`;

export function previewSingle(project: string, request: SingleCropRequest): Promise<CropPlan> {
  return apiRequest(`${path(project)}/single-preview`, {
    method: "POST",
    body: JSON.stringify(request),
  });
}
export function previewBatch(project: string, request: BatchCropRequest): Promise<CropPlan> {
  return apiRequest(`${path(project)}/batch-preview`, {
    method: "POST",
    body: JSON.stringify(request),
  });
}
export function planPage(project: string, id: string, offset: number): Promise<CropPlan> {
  return apiRequest(`${path(project)}/plans/${id}?offset=${offset}&limit=24`);
}
export function cropPreviewUrl(project: string, id: string, index: number): string {
  return apiAssetUrl(`${path(project)}/plans/${id}/items/${index}/result`);
}
export function cropSourceUrl(project: string, id: string, index: number): string {
  return apiAssetUrl(`${path(project)}/plans/${id}/items/${index}/source`);
}
export function executeCrop(project: string, plan: CropPlan): Promise<CropOperation> {
  return apiRequest(`${path(project)}/execute`, {
    method: "POST",
    body: JSON.stringify({ plan_id: plan.id, token: plan.token }),
  });
}
export function listCropOperations(project: string): Promise<CropOperation[]> {
  return apiRequest(`${path(project)}/operations`);
}
export function undoCrop(project: string, id: string): Promise<CropOperation> {
  return apiRequest(`${path(project)}/operations/${id}/undo`, { method: "POST" });
}
export function listRatioPresets(): Promise<RatioPreset[]> {
  return apiRequest("/api/v1/crop-ratio-presets");
}
export function createRatioPreset(value: RatioPresetInput): Promise<RatioPreset> {
  return apiRequest("/api/v1/crop-ratio-presets", { method: "POST", body: JSON.stringify(value) });
}
export function updateRatioPreset(id: string, value: RatioPresetInput): Promise<RatioPreset> {
  return apiRequest(`/api/v1/crop-ratio-presets/${id}`, {
    method: "PUT",
    body: JSON.stringify(value),
  });
}
export function deleteRatioPreset(id: string): Promise<void> {
  return apiRequest(`/api/v1/crop-ratio-presets/${id}`, { method: "DELETE" });
}

export function getCropSource(project: string, outputId: string): Promise<CropProvenance | null> {
  return apiRequest(`${path(project)}/sources/${outputId}`);
}
