import { CheckCircle2, FileQuestion, CircleAlert } from "lucide-react";
import type { AssetFilterStatus } from "../../../../src/shared/api/types";
type StatusFilter = AssetFilterStatus | null;
export const assetFilters: Array<{
  value: StatusFilter;
  label: string;
  icon: typeof CheckCircle2;
}> = [
  { value: null, label: "全部", icon: CheckCircle2 },
  { value: "missing", label: "未标注", icon: FileQuestion },
  { value: "invalid", label: "异常", icon: CircleAlert },
];

export const reviewFilters: Array<{
  value: StatusFilter;
  label: string;
  icon: typeof CheckCircle2;
}> = [
  { value: "needs_review", label: "复核与异常", icon: CircleAlert },
  { value: "unreviewed", label: "尚未复核", icon: FileQuestion },
  { value: "stale", label: "已过期", icon: CircleAlert },
  { value: "failed", label: "生成失败", icon: CircleAlert },
  { value: "invalid", label: "结构异常", icon: CircleAlert },
  { value: "encoding_error", label: "编码异常", icon: CircleAlert },
  { value: "empty", label: "空内容", icon: FileQuestion },
  { value: "unchecked", label: "未校验", icon: FileQuestion },
];
