import type { SourceStatus } from "../../../src/application/cropping/workbenchState";

export const cropStatusLabels: Record<SourceStatus, string> = {
  unconfigured: "未配置",
  pending: "待生成",
  generated: "已生成",
  failed: "失败",
};
