import type { PreprocessOperation } from "../../shared/api/types";

export const activePreprocessStatuses = new Set(["running", "recovering"]);

export const preprocessStatusLabels: Record<string, string> = {
  running: "正在处理",
  recovering: "正在恢复",
  completed: "已完成",
  undone: "已撤销",
  failed: "失败",
};

export const resizeAlgorithmLabels = {
  lanczos3: "Lanczos 3",
  lanczos4: "Lanczos 4",
  anime_low_halo: "二次元低光晕",
} as const;

export const executionModeLabels = {
  auto: "自动选择",
  cpu_only: "仅 CPU",
  prefer_accelerator: "优先硬件加速",
} as const;

export function preprocessProgress(operation: PreprocessOperation) {
  const total = Number.isFinite(operation.item_count) ? Math.max(0, operation.item_count) : 0;
  const completedItems = operation.completed_items;
  if (
    typeof completedItems !== "number" ||
    !Number.isFinite(completedItems) ||
    completedItems < 0
  ) {
    const successful = operation.status === "completed" || operation.status === "undone";
    return {
      total,
      completed: total,
      percent: successful ? 100 : 0,
      determinate: successful,
      legacy: true,
    };
  }
  const completed = Math.min(total, completedItems);
  let percent = total ? Math.round((completed / total) * 100) : 0;
  if (operation.status === "completed" || operation.status === "undone") {
    percent = 100;
  } else if (activePreprocessStatuses.has(operation.status) && total > 0) {
    percent = Math.min(percent, 99);
  }
  return { total, completed, percent, determinate: true, legacy: false };
}

export function preprocessStageLabel(operation: PreprocessOperation): string {
  const progress = preprocessProgress(operation);
  if (operation.status === "recovering") return "正在校验并恢复原文件";
  if (operation.status === "running") {
    if (progress.legacy) return "旧版后端正在处理，等待新的进度字段";
    if (progress.completed <= 0) return "正在准备恢复副本与处理队列";
    if (progress.completed < progress.total) return "正在处理并写入文件";
    return "图片处理完成，正在更新素材索引";
  }
  return preprocessStatusLabels[operation.status] ?? operation.status;
}

export function preprocessProgressCountLabel(
  operation: PreprocessOperation,
  includeUnit = false,
): string {
  const progress = preprocessProgress(operation);
  if (!progress.determinate) {
    return `已处理 ${progress.completed} 张 · 总数暂不可用`;
  }
  return `${progress.completed} / ${progress.total}${includeUnit ? " 张图片" : ""}`;
}

export function preprocessEtaSeconds(operation: PreprocessOperation): number | null {
  return typeof operation.eta_seconds === "number" &&
    Number.isFinite(operation.eta_seconds) &&
    operation.eta_seconds >= 0
    ? operation.eta_seconds
    : null;
}

export function preprocessOptionDetails(operation: PreprocessOperation): string[] {
  const details = [
    operation.options.resize
      ? `最长边 ${operation.options.resize.max_edge} · ${
          resizeAlgorithmLabels[operation.options.resize.algorithm]
        }${operation.options.resize.allow_upscale ? " · 允许放大" : ""}`
      : null,
    operation.options.convert
      ? `${operation.options.convert.format.toUpperCase()} · 质量 ${
          operation.options.convert.quality
        } · 编码强度 ${operation.options.convert.effort}`
      : null,
    operation.options.rename
      ? `重命名 ${operation.options.rename.template} · 从 ${operation.options.rename.start_index} 开始`
      : null,
  ];
  return details.filter((detail): detail is string => Boolean(detail));
}

export function formatDurationSeconds(seconds: number): string {
  if (!Number.isFinite(seconds)) return "暂不可用";
  const rounded = Math.max(0, Math.round(seconds));
  if (rounded < 60) return `${rounded} 秒`;
  const minutes = Math.floor(rounded / 60);
  const remainingSeconds = rounded % 60;
  if (minutes < 60)
    return remainingSeconds ? `${minutes} 分 ${remainingSeconds} 秒` : `${minutes} 分`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes ? `${hours} 小时 ${remainingMinutes} 分` : `${hours} 小时`;
}

export function formatDurationMilliseconds(milliseconds: number): string {
  if (milliseconds < 1000) return `${milliseconds} ms`;
  return formatDurationSeconds(milliseconds / 1000);
}

export function elapsedSeconds(operation: PreprocessOperation): number {
  const finishedAt = operation.completed_at ?? operation.undone_at;
  const end = finishedAt ? new Date(finishedAt).getTime() : Date.now();
  const start = new Date(operation.created_at).getTime();
  const elapsed = (end - start) / 1000;
  return Number.isFinite(elapsed) ? Math.max(0, elapsed) : 0;
}
