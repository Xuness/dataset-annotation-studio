import { apiRequest } from "../../shared/api/client";
import type {
  CropSource,
  CropScopeRequest,
  CropPlan,
  MultiCropRequest,
  PositionedBatchCropRequest,
} from "../../shared/api/types";

function validateSources(items: CropSource[]): CropSource[] {
  if (!Array.isArray(items)) throw new Error("裁剪素材接口未返回列表。");
  const ids = new Set<string>();
  return items.map((item) => {
    if (
      !item ||
      ![item.id, item.relative_path, item.filename, item.content_version].every(
        (value) => typeof value === "string" && value.length > 0,
      ) ||
      ![item.width, item.height].every((value) => Number.isInteger(value) && value > 0)
    ) {
      throw new Error("裁剪素材接口返回了无效的身份、版本或图片尺寸，请重新扫描工作区。");
    }
    if (ids.has(item.id)) throw new Error(`裁剪素材接口返回重复 ID：${item.id}`);
    ids.add(item.id);
    return {
      id: item.id,
      relative_path: item.relative_path,
      filename: item.filename,
      width: item.width,
      height: item.height,
      content_version: item.content_version,
    };
  });
}
export async function selectedCropSources(
  project: string,
  assetIds: string[],
): Promise<CropSource[]> {
  const items = await apiRequest<CropSource[]>(
    `/api/v1/workspaces/${project}/cropping/source-selection`,
    { method: "POST", body: JSON.stringify({ asset_ids: assetIds }) },
  );
  return validateSources(items);
}
export async function scopedCropSources(
  project: string,
  request: CropScopeRequest,
): Promise<CropSource[]> {
  const items = await apiRequest<CropSource[]>(
    `/api/v1/workspaces/${project}/cropping/source-scope`,
    { method: "POST", body: JSON.stringify(request) },
  );
  return validateSources(items);
}
export function previewMultiple(project: string, request: MultiCropRequest): Promise<CropPlan> {
  return apiRequest(`/api/v1/workspaces/${project}/cropping/multi-preview`, {
    method: "POST",
    body: JSON.stringify(request),
  });
}
export function previewPositioned(
  project: string,
  request: PositionedBatchCropRequest,
): Promise<CropPlan> {
  return apiRequest(`/api/v1/workspaces/${project}/cropping/positioned-preview`, {
    method: "POST",
    body: JSON.stringify(request),
  });
}
