import type { CropRect, Ratio } from "../../shared/api/types";

function ratioFactor(ratio: Ratio): number {
  if (![ratio.width, ratio.height].every((value) => Number.isFinite(value) && value > 0)) {
    throw new Error("比例宽高必须是有限正数。");
  }
  const factor = ratio.width / ratio.height;
  if (!Number.isFinite(factor) || factor <= 0) {
    throw new Error(
      `比例因子必须是可表示的有限正数；宽/高计算超出浮点范围，请调整比例宽高：width=${ratio.width}，height=${ratio.height}。`,
    );
  }
  return factor;
}
export function validateRatio(width: string, height: string): Ratio {
  const ratio = { width: Number(width), height: Number(height) };
  ratioFactor(ratio);
  return ratio;
}
export function centeredRect(width: number, height: number, ratio: Ratio | null): CropRect {
  const factor = ratio ? ratioFactor(ratio) : width / height;
  const w = width / height > factor ? Math.max(1, Math.round(height * factor)) : width;
  const h = width / height > factor ? height : Math.max(1, Math.round(width / factor));
  const rect = {
    x: Math.floor((width - w) / 2),
    y: Math.floor((height - h) / 2),
    width: w,
    height: h,
    ratio,
  };
  validateRect(rect, width, height);
  return rect;
}
export function validateRect(rect: CropRect, width: number, height: number): void {
  if (
    ![rect.x, rect.y, rect.width, rect.height].every(Number.isInteger) ||
    rect.x < 0 ||
    rect.y < 0 ||
    rect.width <= 0 ||
    rect.height <= 0 ||
    rect.x + rect.width > width ||
    rect.y + rect.height > height
  ) {
    throw new Error(`裁剪坐标必须为整数且位于原图 ${width}×${height} 内，宽高必须大于零。`);
  }
  if (rect.ratio) {
    const factor = ratioFactor(rect.ratio);
    if (
      Math.min(
        Math.abs(rect.width - rect.height * factor),
        Math.abs(rect.height - rect.width / factor),
      ) >= 1
    ) {
      throw new Error("裁剪框不满足锁定比例，整数取整偏差必须小于一个像素。");
    }
  }
}
export function drawnRect(
  x: number,
  y: number,
  endX: number,
  endY: number,
  width: number,
  height: number,
  ratio: Ratio | null,
): CropRect {
  const left = Math.max(0, Math.min(width - 1, Math.min(x, endX)));
  const top = Math.max(0, Math.min(height - 1, Math.min(y, endY)));
  const availableW = Math.max(1, Math.min(width - left, Math.abs(endX - x)));
  const availableH = Math.max(1, Math.min(height - top, Math.abs(endY - y)));
  const size = centeredRect(availableW, availableH, ratio);
  return { ...size, x: left, y: top };
}
